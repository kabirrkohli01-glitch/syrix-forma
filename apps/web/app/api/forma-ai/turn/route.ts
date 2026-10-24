/* One SYRIX AI turn, streamed.
 *
 * Deliberately NOT at /api/chat — that path is Team Chat, a different feature
 * with a different access model.
 *
 * THE SERVER STORES NOTHING. The conversation is held by the browser and posted
 * in full with each turn; nothing is written to Postgres, to Redis, or to disk
 * at any point in this handler. Attachments are decoded, read, used and dropped
 * with the request. The audit log records that a turn happened and never what
 * was in it, matching the existing rule that private AI prompts are never
 * logged.
 *
 * The one exception, and it is deliberate: an action PROPOSAL is held server
 * side for a few minutes (`lib/ai/hub/actions.ts`), because an approval that
 * round-trips its own payload through the browser is not an approval control.
 */

import { after, NextResponse } from 'next/server';

import { getAiSettings } from '@/features/forma-ai/actions';
import { ask, type Mode } from '@/lib/ai/pipeline/answer';
import { AttachmentError, readAttachments, MAX_FILES, type IncomingFile } from '@/lib/ai/uploads/attachments';
import { logAuditEvent } from '@/lib/permissions/audit';
import { ForbiddenError, requireActiveEmployee } from '@/lib/permissions/current-employee';
import { checkRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit';

/* The sandboxed browser and page fetches need a real runtime, and a turn runs
   far longer than an edge function's budget. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MODES: Mode[] = ['spark', 'auto', 'zenith'];

/* A question long enough to be a pasted document is not a question, and the
   prompt budget cannot absorb one. Rejected here rather than silently
   truncated, because a truncated question produces a confident answer to
   something the user did not ask. Anything longer belongs in an attachment,
   which is read properly. */
const MAX_QUESTION_CHARS = 4000;

interface TurnRequest {
  question?: unknown;
  mode?: unknown;
  history?: unknown;
  files?: unknown;
}

/* Earlier turns, replayed by the browser because the server keeps none.
 *
 * Bounded here rather than trusted: the client is the only thing that decides
 * what to send, and an unbounded history is both a prompt-budget problem and a
 * way to push arbitrary text into a system-adjacent position. */
const MAX_HISTORY_TURNS = 12;
const MAX_HISTORY_CHARS = 8000;

function readHistory(value: unknown): { role: 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(value)) return [];

  const turns: { role: 'user' | 'assistant'; content: string }[] = [];
  let spent = 0;

  for (const entry of value.slice(-MAX_HISTORY_TURNS)) {
    if (!entry || typeof entry !== 'object') continue;
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== 'user' && role !== 'assistant') continue;
    if (typeof content !== 'string' || !content.trim()) continue;

    const text = content.slice(0, MAX_HISTORY_CHARS - spent);
    if (!text) break;

    turns.push({ role, content: text });
    spent += text.length;
    if (spent >= MAX_HISTORY_CHARS) break;
  }

  return turns;
}

function readFiles(value: unknown): IncomingFile[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, MAX_FILES).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const { name, mime, data } = entry as { name?: unknown; mime?: unknown; data?: unknown };
    if (typeof data !== 'string' || !data) return [];
    return [{ name: typeof name === 'string' ? name : 'untitled', mime: typeof mime === 'string' ? mime : '', data }];
  });
}

function event(name: string, payload: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(request: Request) {
  let caller;
  try {
    caller = await requireActiveEmployee();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    throw err;
  }

  /* Per employee, not per IP: everyone reaching here is authenticated, and an office behind one
     address would otherwise share a budget. A turn costs a model round trip and several page
     fetches, so this is about not letting one loop consume what everyone else is waiting for. */
  const limit = await checkRateLimit(
    `ai-turn:${caller.id}`,
    RATE_LIMITS.aiTurn.limit,
    RATE_LIMITS.aiTurn.windowSeconds
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'That is a lot of questions at once. Try again in a moment.' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } }
    );
  }

  let body: TurnRequest;
  try {
    body = (await request.json()) as TurnRequest;
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const files = readFiles(body.files);

  /* A file on its own is a question — "read this" is implied by attaching it. */
  if (!question && !files.length) {
    return NextResponse.json({ error: 'Ask a question.' }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json(
      { error: `That is longer than ${MAX_QUESTION_CHARS} characters. Attach it as a file instead.` },
      { status: 400 }
    );
  }

  /* Read before the stream opens. A file that cannot be accepted is a plain
     400 the composer can show inline — far better than a stream that opens,
     says one thing and closes. */
  let attachments;
  try {
    attachments = readAttachments(files);
  } catch (error) {
    if (error instanceof AttachmentError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'That file could not be read.' }, { status: 400 });
  }

  const mode: Mode = MODES.includes(body.mode as Mode) ? (body.mode as Mode) : 'auto';

  /* READ FROM THE DATABASE, NEVER FROM THE REQUEST.
   *
   * The Hub-access switch decides whether this turn may touch Hub records at
   * all, so a client-supplied value would be a control the client could turn
   * off — which is to say, not a control. The language could safely come from
   * the browser; it comes from the same read anyway, because two sources for
   * one setting is how they end up disagreeing. */
  const settings = await getAiSettings();

  /* Aborting the request must actually stop the work. Without this a user who
     closes the panel leaves searches and a model call running to completion. */
  const controller = new AbortController();
  request.signal.addEventListener('abort', () => controller.abort());

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(queue) {
      const send = (name: string, payload: unknown): void => {
        try {
          queue.enqueue(encoder.encode(event(name, payload)));
        } catch {
          /* The client is gone. The abort listener stops the work; there is
             nothing to report to a closed connection. */
        }
      };

      /* Told up front so the composer can show what it is reading before the
         first stage arrives, and so a note about a file ("this PDF is a scan")
         reaches the user even if the answer never mentions it. */
      if (attachments.length) {
        send('attachments', {
          files: attachments.map((attachment) => ({
            name: attachment.name,
            kind: attachment.kind,
            note: attachment.note ?? null
          }))
        });
      }

      try {
        const answer = await ask(question || 'Read the attached file and tell me what is in it.', {
          mode,
          caller,
          settings,
          history: readHistory(body.history),
          attachments,
          /* Images travel separately from their text: the model is shown the
             picture itself rather than a sentence describing one. */
          media: attachments.flatMap((attachment) => (attachment.media ? [attachment.media] : [])),
          signal: controller.signal,
          onStage: (stage, detail) => send('stage', { stage, detail }),
          onReasoning: (text) => send('reasoning', { text }),
          onToken: (_full, delta) => send('token', { delta })
        });

        send('done', {
          text: answer.text,
          route: answer.route,
          mode: answer.mode,
          citations: answer.citations,
          unsupportedFigures: answer.unsupportedFigures,
          suspiciousSources: answer.suspiciousSources,
          queries: answer.queries,
          hubReads: answer.hubReads,
          proposal: answer.proposal ?? null,
          provider: answer.provider,
          ms: answer.ms,
          council: answer.council
        });

        after(() =>
          logAuditEvent({
            actorEmployeeId: caller.id,
            action: 'forma_ai_turn',
            resourceType: 'forma_ai',
            result: 'success',
            /* The ROUTE, not the question. Knowing that the assistant read Hub
               records rather than the web is an operational fact worth having;
               what was asked is not, and is never written down. */
            metadata: { route: answer.route, mode: answer.mode }
          })
        );
      } catch (error) {
        if (controller.signal.aborted) {
          queue.close();
          return;
        }

        /* Logged where an operator can see it. Until now a failed turn left no
           trace on the server at all: the audit entry records only that a turn
           errored, and the message went to the one person who cannot act on it.
           "SYRIX AI doesn't work" was therefore not diagnosable from the outside.

           The error and its stack, nothing else. Never the question, the
           history or the answer — those are not written down anywhere, and a
           log is still somewhere (docs/forma-ai-architecture.md: the server
           stores nothing). */
        console.error('[forma-ai/turn] turn failed:', error);

        /* Say what went wrong in the user's terms and stop. An assistant that
           fails mid-sentence with an opaque message is worse than one that
           explains it cannot answer right now. */
        send('error', {
          message:
            error instanceof Error && error.message
              ? error.message
              : 'SYRIX AI could not complete that. Try again in a moment.'
        });

        after(() =>
          logAuditEvent({
            actorEmployeeId: caller.id,
            action: 'forma_ai_turn',
            resourceType: 'forma_ai',
            result: 'error'
          })
        );
      } finally {
        queue.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      /* Nginx and similar buffer proxied responses by default, which turns a
         streamed answer back into a long silence followed by everything. */
      'X-Accel-Buffering': 'no'
    }
  });
}
