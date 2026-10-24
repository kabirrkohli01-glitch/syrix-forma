# SYRIX Forma — Data Model (draft)

Status: Phase 0 draft. Expand as each phase adds entities — do not let this drift from the
real schema once Drizzle/Prisma models exist (engineering rule 9).

## Core entities (minimum for Phase 0)

### Employee
- Implemented Phase 1 (`apps/web/lib/db/schema.ts`): id, clerk_user_id (FK to the Clerk user,
  unique), name, email, role (`EMPLOYEE | TEAM_LEAD | MANAGER | ADMIN | SECURITY_ADMIN`,
  nullable until approved), team (free text), status (`pending | active | disabled`),
  mfa_secret_encrypted, mfa_enabled_at, mfa_failed_attempts, mfa_locked_until,
  **step_up_verified_at (Phase 5)**, created_at, updated_at.
- `step_up_verified_at`: stamped by re-entering the current TOTP code immediately before a
  sensitive action ("Approvals" — see the Phase 5 section below), on a sliding 5-minute
  freshness window, not a one-time-use flag. Reuses `mfa_failed_attempts`/`mfa_locked_until` for
  its own lockout rather than a second set of counters — same credential, same brute-force
  concern as the sign-in MFA challenge.
- Auth identity (password, session) lives in Clerk; this table stores the organisation-specific
  profile, role, and the TOTP second factor (Clerk's free tier has no MFA — see
  `DEPENDENCIES.md`).
- `status: 'pending'` = created by the Clerk `user.created` webhook, not yet approved by an
  ADMIN (or auto-promoted via first-user bootstrap). No permissions until `'active'`.

### Audit Log
- Implemented Phase 1: id, actor_employee_id (FK, nullable — set null if the employee is later
  deleted), action, resource_type, resource_id, result (`success | denied | error`), metadata
  (jsonb), created_at.
- Append-only by convention: no update/delete path exists in application code
  (`lib/permissions/audit.ts`). DB-level immutability (restricted role or trigger) is Phase 9.

### Client
- Implemented Phase 2: id, name, service_line (nullable), **team** (text, not null), status
  (`active | inactive`), created_at, updated_at. Assigned staff via the `client_staff`
  many-to-many join table.
- Owned by SYRIX Forma — source of truth (engineering rule 2).
- `team` is an explicit column, not derived from `client_staff` — set at creation (defaults to
  the creator's team), ADMIN can reassign it. Needed so `TEAM_LEAD`-scoped visibility
  (`docs/permissions-matrix.md`) stays an unambiguous flat comparison even if staff assigned to
  a client later span more than one team.

### Project
- Implemented Phase 2: id, client_id (FK -> Client, cascade), name, **team** (text, not null,
  same rationale as Client), status (`active | on_hold | completed | cancelled`), created_at,
  updated_at. Staff via the `project_staff` many-to-many join table. Milestones via
  `project_milestones` (id, project_id FK cascade, title, due_date, completed_at, created_at,
  updated_at) — a real table, not a jsonb blob, since milestone due dates need indexing once
  the Phase 5 Timeline view queries across them.

### Task
- Implemented Phase 2: id, title, description (nullable), status (`todo | in_progress |
  blocked | done`), priority (`low | medium | high | urgent`), due_date (nullable),
  archived_at (nullable — soft-delete: tasks are never hard-deleted, to preserve audit
  history), **team** (text, not null), assignee_id (FK -> Employee, nullable, set null),
  client_id (FK -> Client, nullable, set null), project_id (FK -> Project, nullable, set
  null), created_at, updated_at.
- `team` is the task's own team, independent of `assignee_id` — needed so a TEAM_LEAD can see
  and triage a not-yet-assigned task for their team; scoping by the assignee's team alone would
  make an unassigned task invisible to the team meant to be working it. Set at creation
  (defaults to the creator's team), ADMIN can reassign it.

## Relationships

- Employee 1—N Task (as assignee)
- Client 1—N Project
- Client N—N Employee (assigned staff, via `client_staff`)
- Project 1—N Task
- Project 1—N ProjectMilestone
- Project N—N Employee (staff, via `project_staff`)

### Enquiry
- Implemented Phase 3, extended Phase 4: id, source (`manual | email`, default `manual`),
  contact_name, contact_email, message (nullable), **team** (text, not null, same rationale as
  Client/Project/Task), status (`new | in_progress | awaiting_response | responded | closed`),
  client_id (nullable FK -> Client, set null), created_by (nullable FK -> Employee, set null),
  created_at, updated_at.
- Phase 4: `source: 'email'` is now real — Hostinger Mail's webhook/reconciliation path creates
  these. `created_by` became nullable in that same migration (`0008_low_vanisher.sql`) because an
  email-detected enquiry has no acting employee; manual entry (`source: 'manual'`) still always
  sets it. Notification recipients for a null-`created_by` enquiry fall back to the Hostinger
  Mail integration's owner, then to every active ADMIN (`lib/automations/new-enquiry.ts`'s
  `resolveRecipients`).
- Setting `status` to `awaiting_response` schedules a delayed no-response-follow-up job (see
  Automation below) — the job re-checks the enquiry's status when it fires, not just at
  schedule time, so a response in the meantime correctly cancels the follow-up. A reply detected
  via the Hostinger Mail webhook/reconciliation path also flips status to `responded` directly,
  which the same automation's live re-check correctly treats as "no follow-up needed."

### Automation
- Implemented Phase 3: id, key (unique, e.g. `new-enquiry`), name, description, trigger_event,
  enabled (bool, per-automation on/off), owner_employee_id (FK -> Employee, set null), config
  (jsonb, e.g. `{ "followUpAfterDays": 3 }`), created_at, updated_at.
- One row per automation *definition*, not per run — see AutomationRun below for run history.
- Seeded by migration `0004_cloudy_skrulls.sql` with the two the build plan Phase 3 automations:
  `new-enquiry` and `no-response-follow-up`.
- Phase 5 adds two more, seeded by migration `0013_seed_phase5_automations.sql`:
  `client-inactivity-follow-up` (`{ "inactivityThresholdDays": 14 }`) and
  `project-deadline-reminder` (`{ "daysBeforeDeadline": 3 }`). Unlike the Phase 3 pair, these are
  periodic scans rather than single-resource-event triggers — dispatched by a repeatable BullMQ
  job whose name is the automation key itself (`worker.ts`), so the existing dispatch table in
  `lib/automations/registry.ts` routes them without any special-casing. Each handler creates and
  updates its own `AutomationRun` row (no Server Action call site pre-creates one the way the
  event-triggered automations' `lib/automations/trigger.ts` does).
- `clients.last_inactivity_notified_at` and `project_milestones.last_reminder_sent_at` (both added
  Phase 5) are this pair's own cooldown columns, same role as `tasks.last_reminder_sent_at`.

### AutomationRun
- Implemented Phase 3: id, automation_id (FK -> Automation, cascade), status (`queued | running |
  success | failed | skipped`), trigger_resource_type, trigger_resource_id, error (nullable),
  result (jsonb, nullable), started_at, finished_at, created_at.
- Every automation execution attempt writes exactly one row here via
  `lib/queue/audit-run.ts` — this is what the Automations page's run-history table reads, and
  what makes a forced failure or a kill-switch-triggered skip visible with a clear status
  rather than silent.

### AutomationSettings
- Implemented Phase 3: singleton row (`id` fixed to the literal `'singleton'`, not a uuid — the
  schema guarantees exactly one row can ever exist). kill_switch_enabled (bool, default true),
  updated_by_employee_id, updated_at.
- The one master kill-switch the build plan Phase 3 requires, distinct from each Automation's own
  per-automation `enabled` flag — both are checked before a job is enqueued and again inside the
  worker right before the action runs, so flipping either after a job is already queued/delayed
  still takes effect.

### Notification
- Implemented Phase 3: id, employee_id (FK -> Employee, cascade), type (free text, e.g.
  `task_assigned`, `automation_failed` — not an enum, since this list grows with every phase that
  adds a new notification-worthy event and nothing needs to enforce exhaustiveness across types),
  title, body (nullable), link (nullable), read_at (nullable), created_at.
- In-app notifications only; email delivery for the same events goes through
  `lib/notifications/email.ts` (Resend) as a separate, independently-failing side effect — an
  email failure never rolls back or blocks the in-app notification that already succeeded.

### Task (Phase 3 addition)
- Added `last_reminder_sent_at` (nullable timestamp) — set by the daily due-date reminder scan so
  a task is reminded at most once per calendar day regardless of what time the scan runs.

### Integration
- Implemented Phase 4: id, key (unique — `hostinger_mail` and `microsoft_365` are seeded by
  migration `0007_seed_phase4_integrations.sql`; `google_calendar` is deliberately not seeded,
  since Google Calendar itself hasn't been built), name, enabled (bool, default false), status
  (`not_configured | connected | error`), owner_employee_id (FK -> Employee, set null),
  last_sync_at, last_error, config (jsonb — non-secret settings only, e.g. Hostinger Mail's
  `defaultTeam`), credentials_encrypted (nullable text — AES-256-GCM ciphertext of a JSON
  secrets blob, same construction as `employees.mfa_secret_encrypted`; see
  `lib/integrations/crypto.ts`), created_at, updated_at.
- One row per external system, not per connection attempt — mirrors the Automation entity's
  shape (definition vs. run history) but has no separate run-history table of its own; sync
  outcomes are just `status`/`last_sync_at`/`last_error` on the row itself.

### EmailActivity
- Implemented Phase 4: id, direction (`inbound | outbound`), external_message_id,
  mailbox_resource_id, from_address, to_addresses (jsonb array), subject (nullable), snippet
  (nullable), occurred_at, enquiry_id (nullable FK -> Enquiry, set null), client_id (nullable FK
  -> Client, set null), project_id (nullable FK -> Project, set null), created_at. Unique on
  (mailbox_resource_id, external_message_id) — the idempotency guarantee a redelivered webhook or
  a reconciliation pass rediscovering the same message relies on.
- A lightweight activity ledger, not a full mail mirror — the mailbox stays the authoritative
  copy of message content (engineering rule 2). `client_id`/`project_id` are populated only
  when the activity is explicitly tied to one at creation time (e.g. a reply sent from an
  enquiry already linked to a client) — never inferred by matching email addresses.

### DeadLetterJob
- Implemented Phase 4: id, source (free text, e.g. `hostinger_mail_webhook`,
  `hostinger_mail_reconciliation`), payload (jsonb, nullable), error, failed_at, resolved_at
  (nullable), resolved_by_employee_id (nullable FK -> Employee, set null).
- Generic across every integration, not just email — anything that fails processing an inbound
  integration event lands here instead of throwing past its caller, satisfying the build plan
  Phase 4's "dead-letter queue for failed processing" requirement in one place regardless of
  which system failed. Surfaced on the Settings > Integrations page for an ADMIN to review/resolve.

### DocumentLink
- Implemented Phase 4 (originally scoped for Phase 5 in earlier drafts of this file —
  the build plan's own Phase 4 table already required "reference-only document links on
  client/project pages," so the entity moved up to match): id, label, url, system (`sharepoint |
  onedrive | nas | other`), client_id (nullable FK -> Client, cascade), project_id (nullable FK
  -> Project, cascade), **task_id (nullable FK -> Task, cascade — added Phase 5)**,
  added_by_employee_id (FK -> Employee), last_checked_at (nullable), last_check_status
  (`unknown | ok | broken`, default `unknown`), last_check_error (nullable), created_at,
  updated_at.
- Exactly one of client_id/project_id/task_id is set, enforced by
  `features/document-links/utils/schemas.ts`'s zod refine, not a DB constraint. Reference-only —
  SYRIX Forma never stores the file itself or a storage credential, only a link + label and whether
  it was last reachable (a periodic HEAD/GET check, `lib/integrations/document-links/
  reachability.ts`). A failed check only ever updates `last_check_status` — the row is never
  removed, satisfying the build plan's "Broken link ≠ lost record" failure-behavior requirement.
  Phase 5's task "attachments" reuse this entity rather than a parallel one — a task's attachment
  is the same reference-only concept as a client/project's document link.

## Phase 5: Full Workflows — My Work, expanded

- **Subtask**: not a separate entity — a subtask is a Task row with `parent_task_id` set (self-FK
  on `tasks`, cascade). Gets the same status/priority/assignee/permission scoping as any other
  task; a subtask list is just `tasks` filtered by `parent_task_id`.
- **Recurrence**: two columns added to Task rather than a separate schedule entity:
  `recurrence_rule` (jsonb, `{ frequency: 'daily'|'weekly'|'monthly', interval: number }`, null =
  not recurring) and `recurrence_of_task_id` (self-FK, set null — points at the first task in a
  recurring series, not just the immediate predecessor). Completing a task with a rule set
  generates the next occurrence as a new row (`features/tasks/recurrence.ts`); the completed task
  stays a permanent record rather than resetting in place.
- **ChecklistItem** (`checklist_items`): id, task_id (FK -> Task, cascade), label, done (bool),
  position (int), created_at, updated_at. A flat per-task tick-list, not named/grouped
  checklists — anything needing its own assignee/status/due date is a Subtask instead.
- **TaskComment** (`task_comments`): id, task_id (FK -> Task, cascade), author_employee_id
  (nullable FK -> Employee, set null — survives the author later being removed), body, created_at,
  updated_at.
- **TaskWatcher** (`task_watchers`): id, task_id (FK -> Task, cascade), employee_id (FK ->
  Employee, cascade), created_at. Unique on (task_id, employee_id). Watching yourself only needs
  view access to the task; adding/removing someone else needs edit access.
- **TaskDependency** (`task_dependencies`): id, task_id (FK -> Task, cascade — the dependent
  task), depends_on_task_id (FK -> Task, cascade — the blocking task), created_at. Unique on
  (task_id, depends_on_task_id). Cycle prevention (A depends on B depends on A) is enforced in
  `features/tasks/dependencies-actions.ts` via a graph walk at insert time, not a DB constraint —
  same division of responsibility as DocumentLink's "exactly one of" rule.
- None of the above needed new permission-layer code: every mutation is gated by the parent
  task's existing `canViewTask`/`canEditTask` (`lib/permissions/task-access.ts`), reused as-is.

## Phase 5: native Calendar

- **CalendarEvent** (`calendar_events`): id, title, description (nullable), location (nullable),
  start_at, end_at, all_day (bool), team (text, not null, same creator-defaults/ADMIN-reassign
  pattern as Task/Client/Project/Enquiry), created_by_employee_id (nullable FK -> Employee, set
  null), client_id / project_id (nullable FKs, set null — exactly one may be set, enforced in
  `features/calendar/utils/schemas.ts`, not a DB constraint), created_at, updated_at.
- **CalendarEventAttendee** (`calendar_event_attendees`): id, event_id (FK -> CalendarEvent,
  cascade), employee_id (FK -> Employee, cascade), created_at. Unique on (event_id, employee_id).
  An event's "own" permission scope is creator-or-attendee, not a single assignee — mirrors how
  Client/Project's "own" scope is staff membership rather than an assignee comparison.
  `updateCalendarEvent`/`createCalendarEvent` replace the full attendee set atomically inside a DB
  transaction rather than exposing separate add/remove endpoints.
- This is a real, SYRIX Forma-owned entity, not a stub waiting on Google/Outlook sync — Google
  Calendar sync (the build plan Phase 4) is still explicitly deferred, no OAuth app configured, no
  `integrations` row seeded for it. When that sync is eventually built, it becomes a second writer
  into this same table (an `external_id`/`source` pair, the same de-duplication shape
  EmailActivity already uses for a redelivered webhook), not a parallel calendar. The Calendar
  page's "Connect Google/Outlook" buttons are deliberately inert — they open a dialog stating
  plainly that OAuth setup hasn't happened yet, never a fake successful connection.

## Phase 5: Client Centre, expanded

- **ClientNote** (`client_notes`): id, client_id (FK -> Client, cascade), author_employee_id
  (nullable FK -> Employee, set null), body, created_at, updated_at. Same shape and
  authorship-gated edit/delete as TaskComment.
- No new entity for "linked meetings" or "linked emails" — the client page now queries the native
  Calendar's `calendar_events` (filtered by `client_id`, then per-row through the event's own
  creator-or-attendee scope) and Phase 4's existing `email_activity` (filtered by `client_id`,
  already populated by the Hostinger Mail integration but not surfaced on this page until now).
  "Deadlines" is answered by showing each linked task's own due date inline rather than a separate
  merged view — the data already existed on Task, nothing new was needed.

## Phase 5: project templates per service line

- **ProjectTemplate** (`project_templates`): id, name, service_line (nullable),
  created_by_employee_id (nullable FK -> Employee, set null), created_at, updated_at. Company-wide
  reusable patterns, not team-scoped — same TEAM_LEAD+ tier that already gates creating a project
  at all.
- **ProjectTemplateTask** / **ProjectTemplateMilestone** (`project_template_tasks` /
  `project_template_milestones`): id, template_id (FK -> ProjectTemplate, cascade), title,
  (task rows also: description, priority), relative_due_days (nullable int — an offset from a
  project's chosen start date, never an absolute date), position, created_at.
  `createProjectFromTemplate` (`features/project-templates/actions.ts`) is what turns a template
  into a real Task/ProjectMilestone row with a computed `due_date`, inside one DB transaction with
  the Project insert itself.

## Phase 5: Teams, Global Search, Unified Action Centre

- **Teams**: no new entity — `employees.team`/`clients.team`/`projects.team`/`tasks.team` stay the
  free-text columns every resource already used; `/dashboard/teams` is a dashboard computed over
  them (member list, TEAM_LEAD/MANAGER as "managers", open-task/active-project/active-client
  counts), not a schema change.
- **Global Search**: no new entity or scope logic — `/dashboard/search` reuses each resource's own
  existing scope condition (`clientScopeCondition`, `projectScopeCondition`, `taskScopeCondition`,
  `calendarEventScopeCondition`'s underlying predicates via join), including for Documents/Emails
  by joining to their parent and applying that parent's own condition against the join.
- **Unified Action Centre**: no new entity — the expanded Home dashboard
  (`app/dashboard/page.tsx`) aggregates existing data (Task, Enquiry, ProjectMilestone,
  CalendarEvent, AutomationRun, Integration) behind their own existing permission predicates.
  "Pending approvals" has no row to list — Approvals in this app is inline step-up
  re-authentication (see Employee above), not a request queued for someone else to review.

## Phase 6: Reports & Management Dashboards

- No new entity or column — every metric on `/dashboard/reports` (`apps/web/features/reports/
  utils/queries.ts`) is computed on read from tables that already exist: Employee, Task,
  Project, ProjectMilestone, Client, ClientNote, EmailActivity, Enquiry, Automation,
  AutomationRun. Workload, team workload, active projects, overdue work, project health and
  operational trends all reduce over rows already scoped to a real team/project/employee;
  client activity takes the max of three existing timestamp sources per client
  (`tasks.updatedAt` / `email_activity.occurredAt` / `client_notes.createdAt`) rather than
  adding a dedicated activity-log table.
- **Response times / SLA**: "response" means the first `email_activity` row with
  `direction: 'outbound'` linked to an enquiry — the only response channel this app has an
  exact timestamp for. A phone/in-person reply isn't tracked and isn't guessed at; such an
  enquiry just shows as pending. The SLA target itself (`RESPONSE_SLA_HOURS = 48`) is a fixed
  code constant, not a new settings column — nothing has asked for it to be configurable yet.
- **Project health** is a deterministic function of two counts already computed for the same
  report (`overdueMilestoneCount`, `overdueTaskCount`) — see `features/reports/utils/health.ts`
  for the exact red/amber/green thresholds. Not a stored column: recomputed on every read, same
  as every other Reports figure, so it's always consistent with the live data.
- **Operational trends** buckets by `createdAt` only (Task and Enquiry), the one timestamp both
  already record exactly and unconditionally. A "tasks completed" trend was deliberately left
  out: `tasks` has no `completedAt` column, and `updatedAt` changes on any edit, not just
  completion, so it can't answer "was this finished in this window" without guessing.

## Team Chat (added post-Phase-6, not in the original the build plan plan)

- **Conversation** (`conversations`): id, type (`dm | group`), name (nullable — DMs are named
  from their participants at render time, not stored), created_by_employee_id (nullable FK ->
  Employee, set null), created_at.
- **ConversationParticipant** (`conversation_participants`): id, conversation_id (FK ->
  Conversation, cascade), employee_id (FK -> Employee, cascade), joined_at, last_read_at
  (nullable — drives the unread-count badge; updated by `markConversationRead`, not on every
  message fetch). Unique on (conversation_id, employee_id).
- **Message** (`messages`): id, conversation_id (FK -> Conversation, cascade),
  author_employee_id (nullable FK -> Employee, set null — same "survives the author being
  removed" convention as TaskComment/ClientNote), body, created_at, edited_at (nullable).
- **MessageAttachment** (`message_attachments`): id, message_id (FK -> Message, cascade),
  storage_key, file_name, mime_type, size_bytes, created_at.
- Unlike every other resource in this file, Chat has no `team` column and no
  role/scope-based visibility tier — access is purely "are you a participant of this
  conversation," enforced by `lib/permissions/chat-access.ts` (see
  `docs/permissions-matrix.md`). This mirrors DocumentLink's "reference-only" convention:
  `message_attachments` stores metadata only, never file bytes — the actual upload lives in
  Cloudflare R2 (or a gitignored local-dev folder in development), keyed by `storage_key`. See
  `DEPENDENCIES.md` for the storage adapter.
- **Deliberate v1 scope cuts, not oversights**: no whiteboard/canvas entity — this version is
  messaging + attachments only. No realtime/pub-sub table either — unread state is derived from
  `last_read_at` and delivered via polling (TanStack Query `refetchInterval`), since no
  websocket/SSE infra exists in this app yet.

## Team Status (added post-Phase-6, not in the original the build plan plan)

- No new entity — two columns added directly to `employees` (`workStatus`: `working | on_break |
  logged_off`, default `logged_off`; `workStatusChangedAt`, nullable timestamp). Live presence
  only, deliberately not a timesheet: there is no history table, so "hours worked" cannot be
  derived from this — a v1 scope cut, same category as Team Chat's "no realtime infra yet."
- Set via three buttons (Start working / Take a break / Log off for the day) on the existing
  Teams page (`app/dashboard/teams/page.tsx`) — no new nav item, unlike Team Chat.
  `features/teams/actions.ts`'s `setWorkStatus` is self-only: there is no target-employee id in
  its input, so it can never touch another employee's row.
- Visibility is deliberately company-wide and not team-scoped, unlike every other section of the
  Teams page — the status board shows every active employee regardless of the caller's role/team
  scope. It still sits behind the page's existing `scope === 'none'` gate, so SECURITY_ADMIN
  (walled off from general business data everywhere else in the app) sees none of it either,
  same as the rest of this page.

## To be added in later phases

- Google/Outlook Calendar sync-state entities (deferred — no OAuth app configured yet for either;
  see the native Calendar section above for what already exists independent of that sync)
- Every Phase 5 bullet in the build plan has now shipped: My Work expanded, native Calendar,
  Client Centre expansion, the two new follow-up automations, Approvals (step-up auth), project
  templates, Global Search, Teams, and the Unified Action Centre.
- Phase 6 (Reports & Management Dashboards) has now shipped — see above.

## HR: people records (Stage 1 of the HR module, not in the original the build plan plan)

Added to bring the Breathe HR feature set inside the Hub rather than running a second product
alongside it. HR sits behind one nav entry with its own sub-tabs (`config/hr-nav.ts`); the areas
still to come are rendered as disabled tabs rather than hidden, same convention as the main
nav's `phase` field.

**Employee (existing table, three additions)**
- `manager_id` — self-reference, nullable, `on delete set null`. The line manager. Deliberately
  not derived from the `team` column: HR approval chains do not follow team membership, leave
  and timesheets are approved by one named person, and a team can contain several people who
  lead nothing. Null routes that employee's approvals to HR rather than to nobody.
- `finance_access` — boolean, default false. Breathe's "finance user": pay figures and expense
  amounts only. A flag rather than a role so it composes with the role the holder already has.
- `HR_ADMIN` added to the `employee_role` enum. Deep, not wide — full HR access, and
  `scopeForBusinessData` resolves it to `'own'` for clients/projects/tasks.

**EmployeeProfile** — one row per employee (unique on `employee_id`). Identity and employment
detail: date of birth, National Insurance number (encrypted), personal contact details, home
address, emergency contact, job title, contract type, start/probation/leaving dates, and
contracted days/hours per week for pro-rating part-time leave.

Split from `employees` rather than added to it because `employees` is read on effectively every
request by every role (`lib/permissions/current-employee.ts`). Widening that row with special
category data would put it one careless `select()` away from every screen in the app; a separate
table makes reading it a deliberate act.

**EmployeePay** — one row per employee (unique on `employee_id`). Salary, hourly rate, currency,
pay frequency, bank details, effective-from date, and who last changed it. Split again from
`EmployeeProfile` for the same reason: it is the narrowest and most sensitive table in the
schema, and the only one finance users can reach.

Amounts are stored as encrypted text rather than `numeric`, which means the database cannot sum
or sort them. That is a deliberate trade, not an oversight: payroll totals are computed in the
export path after decryption, and no screen needs to rank employees by salary. Encryption is
AES-256-GCM via `lib/hr/crypto.ts`, which derives its own HKDF domain from the single
`MFA_ENCRYPTION_KEY` master secret — so the key that decrypts a third-party API token cannot
also decrypt payroll, and there is still only one key to manage.

**EmployeeCustomField / EmployeeCustomFieldValue** — Breathe's "custom fields": business-specific
columns HR can add without a migration. Definition and value are separate tables so renaming or
removing a field does not touch every employee's row. Values are held as text regardless of the
field's declared type and parsed on read; a per-type column set would mean five mostly-null
columns per row. `visible_to_employee` defaults false so a field HR invents does not become
self-visible by accident.

**EmployeeTrainingRecord** — training history, qualifications, and the part that earns the table
its place: expiry dates. A first aid certificate or professional licence lapsing unnoticed is
the failure this exists to prevent, so `expires_on` is indexed for the reminder sweep that reads
it rather than being a display-only field. `reminder_sent_at` makes that sweep idempotent.

**Deliberately not added here**: no `team` column on any HR table. HR access is decided by the
line management chain and the HR role (`lib/permissions/hr-access.ts`), and a `team` column
would invite exactly the wrong check.

## HR: time off and absence (Stage 2 of the HR module)

**Durations are integer counts of half days everywhere**, never decimal days. Storing 12.5 days
as a float invites rounding drift once balances are added and subtracted across a year; storing
it as `numeric` returns a string from the driver that every caller then has to parse. Half days
are exact, sortable and summable in SQL. `lib/hr/leave-calculation.ts` owns the conversion for
display, and nothing else divides by two.

**LeaveType** — the categories a request can pick from. `deducts_from_allowance` is the flag
that decides whether a booking touches the balance at all, which is what separates holiday from
unpaid and compassionate leave. `requires_approval` false means the request is recorded and
immediately approved. Seeded with a standard UK set (migration 0023) and editable, because
which categories a business tracks is policy, not schema.

**LeaveSettings / AbsenceTriggerSettings** — single rows, enforced by a unique constraint on a
constant `singleton` column rather than by convention. A second row in either would silently
change everyone's entitlement or thresholds. Both are seeded lazily on first read rather than by
the migration, so a fresh test database does not start with a row every test has to clean up;
the unique constraint makes the race between two first-readers harmless.

**LeaveAllowance** — per employee, per leave year, identified by the leave year's start date
rather than a separate leave_years table. Kept as a row rather than computed from the defaults
so an individual's entitlement can differ (part-time pro-rata, a negotiated extra week, a
mid-year starter) without that difference living in someone's memory. `adjustment_half_days` is
separate from entitlement so a correction stays visible instead of being folded in. When no row
exists the balance falls back to the company default pro-rated by contracted days, and says so
via `hasExplicitAllowance` — an assumed entitlement is shown as an assumption.

**LeaveRequest** — `total_half_days` is computed at submission from the working-day calendar in
force at that moment and then stored, deliberately not recomputed on read: if a public holiday
is added later, an already-approved request must not silently change length. Half days are
supported at each end of a range via `start_unit`/`end_unit`. On approval the request writes an
all-day row into the existing `calendar_events` table so leave appears on the Calendar tab
rather than in a parallel HR-only calendar, and cancelling deletes that event.

**PublicHoliday** — not hard-coded. England and Wales dates move every year, a company closure
day is the same kind of record, and the `region` column leaves room for other calendars.
Seeded for 2026 and 2027 from GOV.UK. Regional calendars for Scotland and Northern Ireland are
deliberately absent rather than guessed.

**SicknessRecord** — `end_date` null means the absence is still open, which is why the table
cannot simply store a duration: most sickness is recorded before its end is known. A second
open record for one person is refused, since it would make "are they off now" unanswerable and
count as two Bradford occurrences for one continuing absence. Fit notes follow the
reference-only convention — metadata here, bytes in object storage.

**ReturnToWorkInterview** — one per absence, enforced by a unique constraint; re-recording
updates rather than creating a second.

**Deliberate v1 limitation, stated rather than hidden**: "working day" means Monday to Friday
for everyone. A part-timer's contracted days pro-rata their *entitlement*, but do not decide
which individual days count as working days, so a Tuesday/Thursday employee booking a full week
is charged five days rather than two. Fixing it properly needs a per-employee working-day
pattern on the profile. Until then HR corrects such cases with the allowance adjustment field.

## HR: documents, performance and engagement (Stage 3 of the HR module)

**HrDocument** — metadata only; the bytes live in object storage via `lib/storage/`, the same
reference-only convention as `message_attachments`. A handbook and an employment contract are
the same kind of record with a different audience, so they share one table and differ by
`visibility` rather than living in two near-identical ones. Uploads are two-step: the row and a
pre-signed URL come back together and the browser PUTs the file straight to storage, so it
never passes through the app server. The storage key is a random UUID, never the filename — a
user-supplied name in a storage path is a traversal and collision risk.

**HrDocumentAcknowledgement** — who accepted what, when, and a hash of the exact bytes they
accepted, so a later replacement cannot silently change what was agreed to. **Deliberately not
a qualified electronic signature**, and not described as one anywhere in the UI: it is an
internal record that a policy was issued and acknowledged. If the organisation needs legally binding
signing, that is a vendor decision. The typed-name check is a usability guard against an
accidental click on a shared screen; the session is what identifies the person.

Archiving sets a timestamp and leaves the stored object in place. An acknowledgement record
pointing at bytes nobody can retrieve proves nothing, so real deletion belongs with the
retention policy still to be written.

**CompanyGoal / Objective / Deliverable** — objectives optionally align to a company goal,
nullable because a personal development objective legitimately ladders up to nothing. Progress
is an integer percent so the database can average it for reporting.

**OneToOne** — carries both shared notes and the manager's private notes. The private field is
the uncomfortable one and the reasoning is recorded in `lib/permissions/hr-access.ts`: a
manager with nowhere to record a private impression keeps it in a notebook, where HR cannot see
it either. A clearly bounded field is the better of two imperfect options. It is visible to the
manager who wrote it and to HR, never to the employee — and it is still disclosable to them on
a subject access request regardless of that rule, which the UI says out loud.

**Appraisal** — one per employee per cycle, enforced by a unique constraint. The self-review
half is the employee's and the manager half plus the rating are not; those are separate
predicates rather than one "can edit appraisal", because collapsing them would let a manager
write somebody's self-assessment for them.

**Kudos** — company-visible by design. Recognition only the recipient's own team can see does
not do the job recognition exists to do.

**Survey / SurveyResponse** — for an anonymous survey `survey_responses.employee_id` is simply
never written. Not written-and-filtered: a populated column excluded on read is one careless
`select()` away from breaking the anonymity the survey promised. `is_anonymous` is fixed at
creation, since flipping it afterwards would either break that promise retroactively or claim
to un-collect identities already stored. For the same reason an anonymous response writes no
audit entry — an audit row naming the actor beside the survey id would reconstruct exactly the
link the null column refuses to store.

The accepted cost is that a second response to an anonymous survey cannot be prevented, because
preventing it needs the link. A repeat answer is a smaller problem than a broken promise.
Results are returned as aggregates (count, average, eNPS) for every survey, anonymous or not,
so a survey cannot become identifiable by being read through a different function.

## HR: time, attendance and expenses (Stage 4 of the HR module)

**Money is integer pence and durations are integer minutes**, for the same reason leave is
integer half days: decimals accumulate rounding error once summed across a timesheet or a
claim, and `numeric` returns strings every caller re-parses. `lib/hr/money.ts` owns every
conversion, and parses pounds digit by digit rather than via `Math.round(value * 100)`, which
loses a penny on inputs whose float representation sits just below the midpoint.

**PayRate** — a new rate is a new row with its own `effective_from`, never an edit. A timesheet
approved last month still has to reconcile against the rate that applied then.

**ShiftTemplate / Shift** — shift times are minutes from midnight rather than a `time` column,
because a shift crossing midnight needs an end greater than 1440, which `time` cannot express.
The template name is copied onto the shift at creation rather than referenced, so editing a
template never silently rewrites rotas already published. **Publishing is separate from
creating**: a rota being drafted notifies nobody, because a half-built rota that pings everyone
trains people to ignore it.

**ShiftSwapRequest — two steps, deliberately.** The colleague accepts, and then a manager
approves; only the approval moves the shift. A swap needing only the other person's agreement
lets two employees rewrite the published rota between them, which is the thing a rota exists to
prevent. Neither party can approve their own swap.

**Timesheet / TimesheetEntry** — a week is the approval unit. Approving forty individual rows
is how timesheet approval stops happening. The week's sheet is created on the first entry, so
nobody has to "open" one. Entries optionally join the existing `projects` table so hours report
against a real budget rather than a second project entity.

**ClockEvent — append-only events, not sessions.** A missing clock-out shows up as missing data
rather than as an open row indistinguishable from someone still working, and pairing happens on
read. Impossible transitions (two clock-ins, a break that never started) are refused at the
action, because storing them makes the day's hours unanswerable.

> **Deliberately absent: location tracking.** Breathe offers geo-tracking and geo-fencing of
> staff. Continuous employee location monitoring needs a DPIA, a lawful basis and staff
> consultation before it can lawfully be switched on in the UK, so it is a separate decision
> rather than a feature to ship because a competitor lists it. `clock_events` carries no
> latitude or longitude columns at all — adding them later is a schema change, and that is the
> point: it must not be possible to enable this by flipping a setting.

**ExpenseCategory / ExpenseClaim / ExpenseItem** — the claim carries a denormalised
`total_pence` maintained by the action layer, because every list screen shows a total and
recomputing per row turns one query into one per claim. Category caps are enforced server-side.

**MileageRate** — HMRC approved rates live in the database, banded by cumulative miles claimed
in the **UK tax year** (6 April to 5 April), which is what decides when the bands reset — not
the calendar year and not the company's leave year. The car rate rose from 45p to 55p for the
first 10,000 miles on 6 April 2026, its first change since 2011, and both generations are
seeded so a journey made before that date still reconciles against the rate that applied then.
Rates verified against gov.uk/government/publications/rates-and-allowances-travel-mileage-and-fuel-allowances

A journey crossing the 10,000-mile threshold is split across both bands rather than charged
entirely at one: the whole trip at the lower rate underpays the employee, and at the higher
rate creates a taxable benefit. Mileage is always calculated server-side — the correct rate
depends on how far the employee has already claimed this tax year, which the browser cannot
know and must not be trusted to assert. Draft claims are excluded from that running total,
since an unsubmitted claim has not been claimed yet.

## HR: learning, health and safety, recruitment (Stage 5 of the HR module)

**Course / CoursePlaylist / CourseEnrolment** — the platform, not the content. Breathe bundles
a library of around a hundred short courses; that content is licensed to Breathe and cannot be
copied, so the catalogue ships empty with an honest empty state saying why, and the organisation adds its
own or links to a provider. Courses are external-URL-first: the organisation is not building a video
platform, and a link to a real provider is more useful than a player with nothing in it.

`expires_on` is computed from the course's `valid_for_months` at the moment of completion and
then stored, so later editing the course's validity cannot retroactively expire or revive
somebody's certificate. Indexed, like training records and safety roles, for the reminder
sweep that reads it — a first aid certificate lapsing unnoticed is the failure all three exist
to prevent.

**RiskAssessment** — likelihood and severity are stored separately, each 1-5, and the banded
`level` is derived from their product at write time so the stored level cannot disagree with
the numbers it came from.

**Incident** — accidents, near misses, hazards, dangerous occurrences and work-related ill
health are one table distinguished by `kind`. They share every field that matters, and
splitting them would turn "everything reported this month" into a union query.

`riddor_reportable` is a flag a human sets during investigation, never inferred. Whether an
incident is reportable under RIDDOR is a legal judgement with a statutory deadline attached,
and software guessing it would be worse than software asking.

**SafetyRole** — fire marshal, first aider, and the certification expiry that makes the record
worth keeping.

**Vacancy / JobApplication / Interview** — candidates are deliberately **not** rows in
`employees`. They have no account, no role and no permissions, and mixing them in would put
non-staff inside every query that assumes an employees row is a colleague. A hired candidate
is converted into a `pending` employee with no role by an explicit HR action, so the new
starter goes through the same approval path as anyone else rather than arriving with
permissions attached. The conversion is idempotent — `converted_employee_id` on the
application means it cannot happen twice.

This table holds personal data about people outside the company, which carries its own
retention question distinct from employee records — recorded in `docs/data-classification.md`
rather than assumed.

## HR: reporting and payroll export (Stage 6 of the HR module)

No new tables. Reporting reads what the earlier stages already record, which is the point of
having modelled leave, absence, timesheets and expenses properly.

**Figures that are approximations say so.** Turnover uses the midpoint of opening and closing
headcount as the average, because a daily average needs a headcount history table that does
not exist. Absence rate assumes ~260 working days per full-time person per year. Both are
labelled as rates in the UI rather than presented as exact counts — a number that looks
precise and is not is worse than one that admits its method.

**Demographic breakdowns suppress small groups.** Anything below five people is collapsed into
a single "groups smaller than five" row rather than listed separately. On a company the organisation's
size, a category containing one person is that person's record wearing a statistic's clothing,
and that is the standard re-identification failure of aggregate reporting. Collapsed rather
than dropped, so the totals still reconcile.

**The burnout monitor needs two signals before it flags anyone** — holiday untaken, repeated
short absences, and consistently long weeks. Any one alone has too many innocent explanations;
somebody saving leave for a long trip is not in trouble. Overtime is measured against the
weeks elapsed so far in the leave year rather than the whole year, or everyone would be
flagged every spring. Like the Bradford score, nothing acts on it.

**Payroll export** is a server action returning a CSV string, deliberately not a GET route: a
URL that returns everyone's pay changes can be pasted, proxied, logged, or left in browser
history. Three controls stack on it — the `canExportPayroll` permission, a fresh TOTP via
`requireStepUpAuth`, and an audit entry written on both success and refusal. The audit entry
records the period and a row count and never the contents, because an audit log that
reproduces the export is a second copy of the thing being protected.

The file contains **changes only** — starters, leavers, unpaid leave, approved expenses,
approved hours. Standing salaries are excluded: a payroll run already holds them, and putting
every salary in a monthly file widens what that file costs if it leaks for no added use.

`lib/hr/csv.ts` escapes leading `=`, `+`, `-` and `@` with a single quote. Without it a value
like `=cmd|'/c calc'!A1` executes when the file is opened in a spreadsheet, and an employee
can get exactly that string into the export simply by typing it into their own name or an
expense description. This is a real path in this data, not a theoretical one.

### Xero payroll integration: not built, and why

the build plan's constraint is that the organisation pays for nothing, verified rather than assumed. Xero
retired free API access on 2 March 2026. The current developer tiers do include a **Starter
tier at no charge** (5 connections, 1,000 calls per organisation per day), which would cover
the organisation's single connection — but Xero's published pricing page does not state whether the
**Payroll** API is included in it, and third-party reporting describes a separate per-business
fee for payroll integration.

"Free tier" and "free for this use" are not the same thing, and that is exactly the trap
the engineering rules warns about. A free path was therefore **not confirmed**, so the integration is not
built and is not stubbed. CSV export covers the actual requirement — getting the month's
changes into whatever payroll system the organisation runs — without a dependency or a cost. If Xero is
wanted later, the open question is narrow and specific: is the Payroll API reachable on the
$0 Starter tier, or does it carry its own fee?

## Documents (added after the HR module — the `DOCUMENTS` nav item finally built)

`/dashboard/documents` was a "coming in Phase 5" stub and its nav item was greyed out, while
`document_links` had existed since Phase 4 with no screen that listed them — they were reachable
only from inside a client, project or task, so there was no way to see the firm's documents at
all. The page now shows both kinds together.

**`document_files`** — a document the Hub itself holds. Metadata only, the same convention as
`message_attachments` and `hr_documents`: the bytes live in object storage under `storage_key`
(`lib/storage/`), never in Postgres and never routed through the app server. Uploads go straight
from the browser to a pre-signed URL.

| Column | Notes |
|---|---|
| `title`, `description` | What people look for. Deliberately not the filename. |
| `storage_key` | A random UUID path, never the filename — a user-supplied name in a storage path is a traversal and collision risk. |
| `file_name`, `mime_type`, `size_bytes` | Shown, and used for the download. The MIME type is a claim from the browser, which is why the accepted set is a short allowlist. |
| `team` | Scoping, copying `clients.team`. Set from the *parent's* team when attached, not the uploader's — otherwise someone attaching a file to another team's client would create a document invisible to the team whose record it belongs to. |
| `client_id` / `project_id` / `task_id` | At most one. Where set, that record's own permission decides access. |
| `archived_at` | Withdrawn rather than deleted, and the stored object is left in place. A document is often the evidence behind a client record. |

Both kinds exist deliberately and neither replaces the other. A link keeps SharePoint, OneDrive or
the NAS authoritative, which is engineering rule 2's rule and the right answer for anything the
firm already manages there. An upload is for what that rule does not cover: a document with no
home anywhere else, which would otherwise live in somebody's inbox.

**Visibility never had to be invented.** An attached document defers to its parent, so attaching a
file can never widen who may read it; only the unattached case needed a rule, and that rule is
`team`. `features/documents/utils/scope.ts` expresses this as SQL so pagination counts rows the
caller can actually see, and single-document reads re-ask the same question against the parent —
a download is reached by id rather than by appearing in a list, and a hand-crafted request must
get the same answer as the interface.

## Connectors (added alongside Documents)

**`connectors`** — an outside service someone connected at runtime, as opposed to `integrations`,
which holds one row per system this codebase has a purpose-built adapter for. The two are separate
tables on purpose: an `integrations` row is seeded by a migration when its adapter ships and its
key is referenced by code, so a user-created row could collide with a key the code expects.

| Column | Notes |
|---|---|
| `kind` | `mcp` (a Model Context Protocol server, verified with a real initialize/tools-list handshake) or `http_api` (a service behind a bearer token or API key header). |
| `base_url` | Checked against `lib/connectors/url-guard.ts` both when saved and again at the moment of every fetch. |
| `status`, `last_checked_at`, `last_error` | "Connected" means the service answered. A save whose check fails is still saved — the credential may be right and the service down — but as `error`, with the reason. |
| `config` | Non-secret only; read straight into server components. For an MCP server it holds what the server reported about itself and the tools it exposes. |
| `credentials_encrypted` | AES-256-GCM, the same construction as `integrations.credentials_encrypted`. Never returned to the browser: the row type the settings page renders has a boolean saying a credential exists and no field that could hold one. |

Everything reached through a connector is untrusted input (engineering rule 12). A tool
description or a response body arriving from one is data to be displayed, never an instruction to
be followed, and no response body is returned to the caller by a verification.
