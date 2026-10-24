/* Acting on the Hub, only ever with a human saying yes.
 *
 * THE ASSISTANT EXECUTES NOTHING. It proposes one of a fixed set of typed
 * actions; a person approves or denies it; and only then does the Hub's own
 * server action run. There is no shell, no arbitrary SQL, and no path from a
 * model's output to a write.
 *
 * THE CLIENT APPROVES AN ID, NOT A PAYLOAD. The proposal — including every
 * parameter — is held here on the server and never round-trips through the
 * browser as something the browser could edit. A tampered client can approve a
 * different proposal or none, but it cannot approve something other than what
 * was shown on the card. This is the difference between an approval control and
 * an approval-shaped animation.
 *
 * APPROVAL RE-RUNS AUTHORIZATION. Execution calls the same server action the
 * Hub's own screens call — `createTask`, `createCalendarEvent`, `addClientNote`
 * — each of which begins with `requireActiveEmployee()` and its own permission
 * checks. Nothing here is trusted to have checked anything earlier: showing a
 * card is not a control, exactly as hiding a button is not (engineering rule 10).
 *
 * WHY THE REGISTRY IS SHORT, AND WHY IT HAS NO SEND. `hub.email.send` and the
 * export actions are in the architecture's table behind step-up auth; they are
 * deliberately not implemented here. An assistant that can create a task on
 * approval and one that can email a client on approval are different products
 * with different blast radii, and the second needs the step-up path wired
 * through this file before it is offered. An action absent from this registry
 * cannot be proposed at all — that absence IS the control (§8, layer 1).
 */

import { eq } from 'drizzle-orm';
import * as z from 'zod';

import { createTask } from '@/features/tasks/actions';
import { createCalendarEvent } from '@/features/calendar/actions';
import { addClientNote } from '@/features/clients/notes-actions';
import { db } from '@/lib/db/client';
import { clients } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';

/* ---------- the registry ---------- */

export const ACTION_KINDS = ['hub.task.create', 'hub.calendar.createEvent', 'hub.client.note.add'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/* Schemas are deliberately NARROWER than the underlying feature schemas.
 *
 * `createTaskSchema` accepts a recurrence rule, a parent task, an arbitrary
 * team and an assignee id. The assistant is offered none of those: it names a
 * task and, at most, a due date and a priority. Every field the model can fill
 * is a field an injected page can try to fill, and a recurrence rule quietly
 * added to a task is a change nobody re-reads the card for.
 *
 * Dates are ISO strings rather than Date objects because a proposal crosses a
 * JSON boundary on its way to being displayed, and a Date that survived that
 * trip by accident is a Date nobody validated. */
/* `offset: true` is required, not cosmetic.
 *
 * Zod's `datetime()` accepts only UTC by default, and the model is instructed
 * to send UK local time WITH its offset — because a 2pm appointment written as
 * 14:00Z is 3pm in London for seven months of the year. Without this the
 * correct timestamp is rejected as malformed and no card is ever produced. */
const TIMESTAMP = z.string().datetime({ offset: true });

const taskCreate = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  /** Rendered to the reader in full, in UK time, before they approve anything. */
  dueDate: TIMESTAMP.optional()
});

const calendarCreate = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  location: z.string().max(300).optional(),
  startAt: TIMESTAMP,
  endAt: TIMESTAMP,
  allDay: z.boolean().optional()
});

const clientNote = z.object({
  clientId: z.string().uuid(),
  /** Shown verbatim on the card. What is approved is what is written. */
  body: z.string().min(1).max(4000)
});

const SCHEMAS = {
  'hub.task.create': taskCreate,
  'hub.calendar.createEvent': calendarCreate,
  'hub.client.note.add': clientNote
} as const;

export type ActionParams = {
  'hub.task.create': z.infer<typeof taskCreate>;
  'hub.calendar.createEvent': z.infer<typeof calendarCreate>;
  'hub.client.note.add': z.infer<typeof clientNote>;
};

/* ---------- what the card shows ---------- */

export interface RenderedField {
  label: string;
  /** PLAIN TEXT ONLY. Never markdown, never HTML — see the note on `render`. */
  value: string;
}

export interface Proposal {
  id: string;
  kind: ActionKind;
  /** One line naming the action, for the card's heading. */
  summary: string;
  /** Every real parameter, fully rendered. Not a description of intent. */
  fields: RenderedField[];
  /** Why the assistant proposed it, in its own words. */
  reason: string;
  /** The Hub area this touches, so the reader knows what is at stake. */
  resource: string;
  createdAt: number;
}

/* Rendering is deliberately dumb: it formats values and escapes nothing,
 * because nothing downstream interprets what it produces.
 *
 * The card renders these as text nodes. That is the actual defence — an
 * approval card that ran markdown could be handed `**Send to accounts**` as a
 * title and a very different body, and the reader would approve what they read
 * rather than what would run. Keeping the renderer incapable of emitting markup
 * is stronger than sanitising markup it was allowed to emit. */
/* UK TIME, EXPLICITLY, NOT THE SERVER'S TIME.
 *
 * `toLocaleString` with no zone formats in whatever zone the process happens to
 * run in. Asked to schedule something for 2pm, the model emitted a correct
 * timestamp and the card rendered it as 15:00 — the reader was being asked to
 * approve a meeting an hour later than the one they asked for, with nothing on
 * screen to suggest anything had gone wrong. That is the worst shape a bug can
 * take on an approval card.
 *
 * the organisation is a London business and its staff mean London time. Pinning the ZONE
 * rather than an offset keeps this correct across the BST boundary, and makes
 * the card independent of where the server is deployed. */
const DISPLAY_ZONE = 'Europe/London';

function renderDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-GB', {
    timeZone: DISPLAY_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/* The client's NAME, looked up here rather than taken from the model.
 *
 * A card reading "Client: 8f3c1a52-…" asks somebody to approve a write to a
 * record they cannot identify, which is an approval in form only. Resolving it
 * from the database is also the only trustworthy way to do it: a name supplied
 * alongside the id could disagree with it, and the reader would approve the
 * name while the write went to the id. */
async function clientNameFor(clientId: string): Promise<string> {
  const [row] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId)).limit(1);
  return row ? `${row.name} (${clientId})` : `unknown client (${clientId})`;
}

async function render(
  kind: ActionKind,
  params: Record<string, unknown>
): Promise<{ summary: string; resource: string; fields: RenderedField[] }> {
  if (kind === 'hub.task.create') {
    const value = params as ActionParams['hub.task.create'];
    return {
      summary: 'Create a task',
      resource: 'My Work',
      fields: [
        { label: 'Title', value: value.title },
        ...(value.description ? [{ label: 'Description', value: value.description }] : []),
        { label: 'Priority', value: value.priority ?? 'medium' },
        { label: 'Due', value: value.dueDate ? renderDate(value.dueDate) : 'no due date' },
        /* Stated rather than left to be inferred. "It will be assigned to you"
           is a real consequence of approving, and an unstated default is the
           kind of thing people discover afterwards. */
        { label: 'Team', value: 'your own team' }
      ]
    };
  }

  if (kind === 'hub.calendar.createEvent') {
    const value = params as ActionParams['hub.calendar.createEvent'];
    return {
      summary: 'Add a calendar event',
      resource: 'Calendar',
      fields: [
        { label: 'Title', value: value.title },
        ...(value.description ? [{ label: 'Description', value: value.description }] : []),
        { label: 'Starts', value: value.allDay ? `${renderDate(value.startAt)} (all day)` : renderDate(value.startAt) },
        { label: 'Ends', value: renderDate(value.endAt) },
        ...(value.location ? [{ label: 'Location', value: value.location }] : []),
        { label: 'Attendees', value: 'none — you can add people after it is created' },
        { label: 'Team', value: 'your own team' }
      ]
    };
  }

  const value = params as ActionParams['hub.client.note.add'];
  return {
    summary: 'Add a note to a client record',
    resource: 'Clients',
    fields: [
      { label: 'Client', value: await clientNameFor(value.clientId) },
      { label: 'Note', value: value.body }
    ]
  };
}

/* ---------- the store ---------- */

interface StoredProposal extends Proposal {
  /** Validated parameters. Never sent to the browser. */
  params: Record<string, unknown>;
  /** Only this employee may approve it. */
  ownerEmployeeId: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
}

/* Process-local, and short-lived by design.
 *
 * A proposal carries text derived from the conversation, and the conversation is
 * not stored anywhere — so putting proposals in Postgres would make the one
 * durable copy of a chat the copy nobody expected to exist. Redis is available
 * and would survive a restart, which is the wrong property here: a proposal
 * older than the tab that made it should not be approvable at all.
 *
 * A lost proposal on restart is a card that says it expired, which is the safe
 * failure. The audit log still records that it was proposed. */
/* Pinned to `globalThis` rather than a plain module-level `const`.
 *
 * `propose()` runs from the turn route, `approve()`/`deny()` from the approval
 * route — two different route handlers, each its own entry point in Next.js's
 * dev bundler. A plain module-level Map can end up re-instantiated per bundle
 * (or per hot-reload) instead of shared, so a proposal made on one request was
 * silently invisible to the next: the card said "Go ahead", execution reported
 * "That request has expired" immediately, and nothing had actually run. Storing
 * it on `globalThis` behind a fixed key is the standard fix for exactly this —
 * the same pattern used for a singleton DB client — and keeps the map a true
 * process-local singleton no matter how many module instances import it. */
const globalForProposals = globalThis as unknown as { formaAiProposals?: Map<string, StoredProposal> };
const proposals = globalForProposals.formaAiProposals ?? new Map<string, StoredProposal>();
globalForProposals.formaAiProposals = proposals;

const TTL_MS = 15 * 60 * 1000;
const MAX_PENDING = 200;

function sweep(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, proposal] of proposals) {
    if (proposal.createdAt < cutoff) proposals.delete(id);
  }
  /* A runaway loop proposing forever must not grow the map without bound.
     Oldest first — Map preserves insertion order. */
  while (proposals.size > MAX_PENDING) {
    const oldest = proposals.keys().next();
    if (oldest.done) break;
    proposals.delete(oldest.value);
  }
}

export class ProposalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProposalError';
  }
}

/**
 * Record a proposal and return the card to show.
 *
 * Validation happens here, before anything is displayed, so a malformed
 * proposal fails as a proposal rather than as a confusing card the user
 * approves and then watches error.
 */
export async function propose<K extends ActionKind>(
  caller: ActiveEmployee,
  kind: K,
  rawParams: unknown,
  reason: string
): Promise<Proposal> {
  sweep();

  const schema = SCHEMAS[kind];
  const parsed = schema.safeParse(rawParams);
  if (!parsed.success) {
    throw new ProposalError(
      `That action was not proposed correctly: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`
    );
  }

  const params = parsed.data as Record<string, unknown>;
  const { summary, resource, fields } = await render(kind, params);

  const proposal: StoredProposal = {
    id: crypto.randomUUID(),
    kind,
    summary,
    resource,
    fields,
    reason: reason.trim().slice(0, 400),
    createdAt: Date.now(),
    params,
    ownerEmployeeId: caller.id,
    status: 'pending'
  };

  proposals.set(proposal.id, proposal);

  /* A proposal is worth logging on its own. If an injected page ever does get
     one created, the record of the attempt is what makes it findable — and a
     denial is as interesting as an approval. */
  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'forma_ai_action_proposed',
    resourceType: 'forma_ai_action',
    resourceId: proposal.id,
    result: 'success',
    metadata: { kind, fields: fields.map((field) => field.label) }
  });

  const { params: _params, ownerEmployeeId: _owner, status: _status, ...card } = proposal;
  return card;
}

/** The card again, for a client that has the id but not the payload. */
export function getProposal(id: string, caller: ActiveEmployee): Proposal | null {
  sweep();
  const stored = proposals.get(id);
  if (!stored || stored.ownerEmployeeId !== caller.id || stored.status !== 'pending') return null;
  const { params: _params, ownerEmployeeId: _owner, status: _status, ...card } = stored;
  return card;
}

export interface ExecutionResult {
  ok: boolean;
  /** What happened, in the user's terms. Shown in the conversation. */
  message: string;
  /** Where to go and look at it, when there is somewhere. */
  href?: string;
}

/**
 * Approve and execute.
 *
 * `caller` is resolved from the session by the route, never from the request
 * body. The ownership check below is therefore a real check and not a
 * formality: a proposal made in one person's session cannot be approved from
 * another's, even with the id.
 */
export async function approve(id: string, caller: ActiveEmployee): Promise<ExecutionResult> {
  sweep();
  const stored = proposals.get(id);

  if (!stored) {
    throw new ProposalError('That request has expired. Ask again and approve the new card.');
  }
  if (stored.ownerEmployeeId !== caller.id) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'forma_ai_action_approved',
      resourceType: 'forma_ai_action',
      resourceId: id,
      result: 'denied',
      metadata: { reason: 'proposal belongs to another employee' }
    });
    throw new ProposalError('That request was not made in this session.');
  }
  if (stored.status !== 'pending') {
    throw new ProposalError('That request has already been answered.');
  }

  /* Consumed before execution, not after. Two clicks on a slow network must not
     create two tasks, and a failed execution must not leave a card that can be
     retried into a duplicate — the user asks again instead. */
  stored.status = 'approved';

  try {
    const result = await run(stored);

    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'forma_ai_action_approved',
      resourceType: 'forma_ai_action',
      resourceId: id,
      result: 'success',
      /* Parameters, not a summary. An audit entry that records "a task was
         created" answers none of the questions an audit is read to answer. */
      metadata: { kind: stored.kind, params: stored.params }
    });

    return result;
  } catch (error) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'forma_ai_action_approved',
      resourceType: 'forma_ai_action',
      resourceId: id,
      result: 'error',
      metadata: { kind: stored.kind }
    });

    /* The underlying action's own message is the useful one — "Not permitted to
       create a task outside your own team" tells the reader what to do next,
       where a generic failure does not. */
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'That could not be carried out.'
    };
  } finally {
    proposals.delete(id);
  }
}

/** Deny. Logged as carefully as an approval — a refused proposal is a signal. */
export async function deny(id: string, caller: ActiveEmployee): Promise<void> {
  const stored = proposals.get(id);
  if (!stored || stored.ownerEmployeeId !== caller.id) return;

  stored.status = 'denied';
  proposals.delete(id);

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'forma_ai_action_denied',
    resourceType: 'forma_ai_action',
    resourceId: id,
    result: 'success',
    metadata: { kind: stored.kind, params: stored.params }
  });
}

/* The one place a proposal becomes a write. Each branch calls the Hub's own
   server action — the same function the Hub's own form calls — so permission
   checks, validation, notifications and revalidation all happen exactly once
   and in one implementation. */
async function run(stored: StoredProposal): Promise<ExecutionResult> {
  if (stored.kind === 'hub.task.create') {
    const params = stored.params as ActionParams['hub.task.create'];
    const created = await createTask({
      title: params.title,
      description: params.description,
      priority: params.priority ?? 'medium',
      dueDate: params.dueDate ? new Date(params.dueDate) : undefined
    });
    return { ok: true, message: `Task created: ${created.title}`, href: '/dashboard/my-work' };
  }

  if (stored.kind === 'hub.calendar.createEvent') {
    const params = stored.params as ActionParams['hub.calendar.createEvent'];
    const created = await createCalendarEvent({
      title: params.title,
      description: params.description,
      location: params.location,
      startAt: new Date(params.startAt),
      endAt: new Date(params.endAt),
      allDay: params.allDay ?? false
    });
    return { ok: true, message: `Added to the calendar: ${created.title}`, href: '/dashboard/calendar' };
  }

  const params = stored.params as ActionParams['hub.client.note.add'];
  await addClientNote(params.clientId, { body: params.body });
  return { ok: true, message: 'Note added to the client record.', href: `/dashboard/clients/${params.clientId}` };
}
