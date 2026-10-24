'use client';

/* The conversation, and the only place it exists.
 *
 * IN MEMORY, DELIBERATELY. Nothing here touches localStorage, sessionStorage,
 * IndexedDB, cookies or the URL. A refresh loses the conversation and that is
 * the intended behaviour, not an omission: this assistant is used on client
 * matters, and a transcript that survives the tab is a transcript somebody can
 * later be asked to produce.
 *
 * The provider is mounted once in the dashboard layout so the side panel and
 * the full tab read the same state. Moving between them is a change of mount,
 * not of conversation — no reload, no re-fetch, nothing to reconcile.
 *
 * "New chat" is destructive and immediate. There is no undo and no archive,
 * because either would be a saved transcript wearing a different name.
 *
 * WHAT THE SERVER IS SENT EACH TURN, AND WHY IT IS MORE THAN IT WAS. The server
 * holds no transcript, so context is whatever the browser replays. It used to
 * replay three turns, which is enough not to greet somebody twice and not
 * enough for "and what about the other one" to mean anything — a follow-up
 * would route as small talk or search for four words. Eight turns is sent now,
 * and the server caps it again on arrival because the client is not trusted to
 * have capped anything.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type Mode = 'spark' | 'auto' | 'zenith';

/* Which of the pipeline's paths answered. Decides what a turn shows.
 *
 * Declared here rather than imported from `lib/ai/pipeline/route` on purpose:
 * this is a client component, and importing from the pipeline would pull the
 * gateway client, the database and the whole server half of the feature into
 * the browser bundle. The cost is that the two lists have to be kept in step. */
export type Route = 'chat' | 'self' | 'hub' | 'action' | 'reason' | 'research' | 'draft';

export interface Citation {
  label: string;
  url: string;
  authority: string;
  publishedAt?: string;
  retrievedAt: number;
}

export interface StageEntry {
  stage: string;
  detail?: string;
  /** When it arrived, so the panel can show how long a step actually took. */
  at: number;
}

export interface CouncilReport {
  id: string;
  title: string;
  ok: boolean;
  text: string | null;
  confidence: 'low' | 'medium' | 'high' | null;
  reason: string | null;
}

export interface CouncilSummary {
  roster: { id: string; title: string }[];
  reports: CouncilReport[];
  corrections: string[];
  trimmed: string | null;
}

export interface ProposalField {
  label: string;
  value: string;
}

export interface Proposal {
  id: string;
  kind: string;
  summary: string;
  fields: ProposalField[];
  reason: string;
  resource: string;
  createdAt: number;
}

export interface AttachedFile {
  name: string;
  kind: 'pdf' | 'image' | 'text';
  note?: string | null;
}

/** A file chosen in the composer, before it is sent. */
export interface PendingFile {
  name: string;
  mime: string;
  size: number;
  /** Base64, read in the browser. Never written anywhere. */
  data: string;
}

export interface Turn {
  id: string;
  question: string;
  answer: string;
  route: Route;
  mode: Mode;
  status: 'running' | 'done' | 'error' | 'stopped';
  /** The pipeline's real stages, in order. */
  stages: StageEntry[];
  /** The model's own working, captured on its way out of the answer. */
  reasoning: string[];
  citations: Citation[];
  unsupportedFigures: string[];
  suspiciousSources: { label: string; signals: string[] }[];
  queries: string[];
  hubReads: { label: string; rows: number }[];
  attachments: AttachedFile[];
  /** Set on the action route. Cleared once answered — a decided card is history. */
  proposal?: Proposal;
  /** What happened after the user approved or denied. */
  proposalOutcome?: { ok: boolean; message: string; href?: string };
  provider?: string;
  ms?: number;
  /**
   * When the question was sent, recorded once here rather than read from the
   * clock while rendering.
   *
   * The elapsed counter used to fall back to `Date.now()` when no stage had
   * arrived yet, which meant it was re-read on every render and the turn's start
   * moved forward each time — the timer sat near zero for the whole of the first
   * second instead of counting. Asking the clock during render also makes the
   * component impure, so this is both the correct value and the correct place.
   */
  startedAt: number;
  error?: string;
  council?: CouncilSummary;
}

interface ConversationState {
  turns: Turn[];
  mode: Mode;
  busy: boolean;
  setMode: (mode: Mode) => void;
  ask: (question: string, files?: PendingFile[]) => void;
  stop: () => void;
  newChat: () => void;
  decide: (turnId: string, proposalId: string, verdict: 'approve' | 'deny') => Promise<void>;
}

const ConversationContext = createContext<ConversationState | null>(null);

/* Frames arrive as `event: <name>` then `data: <json>`, separated by a blank
   line. Parsed here rather than with EventSource because a turn is a POST —
   EventSource can only issue GETs, and the question does not belong in a URL
   where it would reach browser history and server access logs. */
function parseFrames(buffer: string): { frames: { name: string; data: string }[]; rest: string } {
  const parts = buffer.split('\n\n');
  /* The trailing piece is incomplete until the next read delivers its blank
     line, so it stays in the buffer. */
  const rest = parts.pop() ?? '';
  const frames: { name: string; data: string }[] = [];

  for (const part of parts) {
    let name = 'message';
    const data: string[] = [];

    for (const line of part.split('\n')) {
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }

    if (data.length) frames.push({ name, data: data.join('\n') });
  }

  return { frames, rest };
}

export function ConversationProvider({ children }: { children: React.ReactNode }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [mode, setMode] = useState<Mode>('auto');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  /* Read inside `ask` without making the conversation a dependency of it —
     otherwise the callback is rebuilt on every streamed token. */
  const turnsRef = useRef<Turn[]>([]);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  const update = useCallback((id: string, patch: Partial<Turn> | ((turn: Turn) => Partial<Turn>)) => {
    setTurns((current) =>
      current.map((turn) =>
        turn.id === id ? { ...turn, ...(typeof patch === 'function' ? patch(turn) : patch) } : turn
      )
    );
  }, []);

  const ask = useCallback(
    (question: string, files: PendingFile[] = []) => {
      const trimmed = question.trim();
      if ((!trimmed && !files.length) || abortRef.current) return;

      const id = crypto.randomUUID();
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);

      setTurns((current) => [
        ...current,
        {
          id,
          question: trimmed || `Read ${files.map((file) => file.name).join(', ')}`,
          answer: '',
          /* Assumed research until the server says otherwise, so a turn that
             does search never briefly renders as though it did not. */
          route: 'research',
          mode,
          status: 'running',
          startedAt: Date.now(),
          stages: [],
          reasoning: [],
          citations: [],
          unsupportedFigures: [],
          suspiciousSources: [],
          queries: [],
          hubReads: [],
          attachments: files.map((file) => ({
            name: file.name,
            kind: file.mime.startsWith('image/') ? 'image' : file.mime === 'application/pdf' ? 'pdf' : 'text'
          }))
        }
      ]);

      void (async () => {
        try {
          const response = await fetch('/api/forma-ai/turn', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question: trimmed,
              mode,
              files,
              /* The server holds no transcript, so the browser sends what the
                 reply needs to make sense. Only completed turns — a failed one
                 has nothing worth replaying. */
              history: turnsRef.current
                .filter((turn) => turn.status === 'done' && turn.answer)
                .slice(-8)
                .flatMap((turn) => [
                  { role: 'user' as const, content: turn.question },
                  { role: 'assistant' as const, content: turn.answer }
                ])
            }),
            signal: controller.signal
          });

          if (!response.ok || !response.body) {
            /* A non-streaming failure answers with JSON. */
            let message = 'SYRIX AI is unavailable right now.';
            try {
              const failure = (await response.json()) as { error?: string };
              if (failure.error) message = failure.error;
            } catch {
              /* Keep the generic message. */
            }
            update(id, { status: 'error', error: message });
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const { frames, rest } = parseFrames(buffer);
            buffer = rest;

            for (const frame of frames) {
              let payload: Record<string, unknown>;
              try {
                payload = JSON.parse(frame.data) as Record<string, unknown>;
              } catch {
                continue;
              }

              if (frame.name === 'stage') {
                update(id, (turn) => ({
                  stages: [
                    ...turn.stages,
                    {
                      stage: String(payload.stage ?? ''),
                      detail: payload.detail as string | undefined,
                      at: Date.now()
                    }
                  ]
                }));
              } else if (frame.name === 'reasoning') {
                const text = String(payload.text ?? '').trim();
                if (text) update(id, (turn) => ({ reasoning: [...turn.reasoning, text] }));
              } else if (frame.name === 'attachments') {
                update(id, { attachments: (payload.files as AttachedFile[]) ?? [] });
              } else if (frame.name === 'token') {
                const delta = String(payload.delta ?? '');
                update(id, (turn) => ({ answer: turn.answer + delta }));
              } else if (frame.name === 'done') {
                update(id, {
                  status: 'done',
                  /* The final text is the guarded one, which is not always what
                     streamed — narration stripping and figure marking happen
                     after the last token. Replacing it is the point. */
                  answer: String(payload.text ?? ''),
                  route: (payload.route as Route) ?? 'research',
                  citations: (payload.citations as Citation[]) ?? [],
                  unsupportedFigures: (payload.unsupportedFigures as string[]) ?? [],
                  suspiciousSources:
                    (payload.suspiciousSources as { label: string; signals: string[] }[]) ?? [],
                  queries: (payload.queries as string[]) ?? [],
                  hubReads: (payload.hubReads as { label: string; rows: number }[]) ?? [],
                  proposal: (payload.proposal as Proposal | null) ?? undefined,
                  provider: payload.provider as string | undefined,
                  ms: payload.ms as number | undefined,
                  council: payload.council as CouncilSummary | undefined
                });
              } else if (frame.name === 'error') {
                update(id, {
                  status: 'error',
                  error: String(payload.message ?? 'SYRIX AI could not complete that.')
                });
              }
            }
          }

          /* The stream ended without a terminal frame — the connection dropped
             mid-answer. Say so rather than leaving a spinner running. */
          update(id, (turn) =>
            turn.status === 'running'
              ? { status: 'error', error: 'The connection ended before the answer was complete.' }
              : {}
          );
        } catch (error) {
          if (controller.signal.aborted) {
            update(id, (turn) => (turn.status === 'running' ? { status: 'stopped' } : {}));
            return;
          }
          update(id, {
            status: 'error',
            error: error instanceof Error ? error.message : 'Something went wrong.'
          });
        } finally {
          abortRef.current = null;
          setBusy(false);
        }
      })();
    },
    [mode, update]
  );

  /**
   * Approve or deny a proposed action.
   *
   * The id is all that is sent. The action and its parameters are held on the
   * server precisely so this call cannot carry them — see
   * `lib/ai/hub/actions.ts`.
   */
  const decide = useCallback(
    async (turnId: string, proposalId: string, verdict: 'approve' | 'deny') => {
      /* Cleared first. A card that stays on screen while the request is in
         flight can be clicked twice, and the second click races the first. */
      update(turnId, { proposal: undefined });

      try {
        const response = await fetch('/api/forma-ai/approval', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: proposalId, verdict })
        });

        const result = (await response.json()) as {
          ok?: boolean;
          message?: string;
          href?: string;
          error?: string;
        };

        update(turnId, {
          proposalOutcome: {
            ok: response.ok && result.ok !== false,
            message: result.error ?? result.message ?? 'Done.',
            href: result.href
          }
        });
      } catch {
        update(turnId, {
          proposalOutcome: { ok: false, message: 'That could not be sent. Nothing was changed.' }
        });
      }
    },
    [update]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setTurns([]);
  }, []);

  const value = useMemo(
    () => ({ turns, mode, busy, setMode, ask, stop, newChat, decide }),
    [turns, mode, busy, ask, stop, newChat, decide]
  );

  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

export function useConversation(): ConversationState {
  const context = useContext(ConversationContext);
  if (!context) {
    throw new Error('useConversation must be used inside a ConversationProvider.');
  }
  return context;
}
