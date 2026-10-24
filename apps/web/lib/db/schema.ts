import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid
} from 'drizzle-orm/pg-core';

// Keep in sync with docs/permissions-matrix.md and engineering rule 10.
export const employeeRoleEnum = pgEnum('employee_role', [
  'EMPLOYEE',
  'TEAM_LEAD',
  'MANAGER',
  'ADMIN',
  'SECURITY_ADMIN',
  // HR_ADMIN is deliberately not "ADMIN plus HR". It is the only role that can read an
  // employee's medical, pay and bank detail, and it carries no elevated access to
  // client/project/task data at all — scopeForBusinessData treats it exactly like an
  // EMPLOYEE. Kept separate from ADMIN for the same reason SECURITY_ADMIN is: platform
  // administration should not silently confer standing access to everyone's special
  // category personal data. See docs/permissions-matrix.md.
  'HR_ADMIN'
]);

// 'pending': created by the Clerk user.created webhook, not yet assigned a role/team by an
// ADMIN (or auto-promoted via the first-user bootstrap). Has no permissions until 'active'.
//
// 'rejected' is distinct from 'disabled' and the difference is not cosmetic. 'disabled' means an
// account that was once approved and has been withdrawn — it keeps its audit history, its
// authored records and its place in the staff directory. 'rejected' means access was never
// granted in the first place: a stranger who found the sign-up page. Without a separate state
// there is no way to say no — refusing meant either leaving the request 'pending' for ever, so
// it reappeared in the approval queue at every glance, or 'disabled', which files an outsider
// alongside former staff.
export const employeeStatusEnum = pgEnum('employee_status', [
  'pending',
  'active',
  'disabled',
  'rejected'
]);

// Separate from employeeStatusEnum above (pending/active/disabled = account approval state).
// This is the live "am I clocked in" presence state, self-set from the Teams page. Default
// 'logged_off' — a freshly-approved employee hasn't clocked in yet.
export const workStatusEnum = pgEnum('employee_work_status', ['working', 'on_break', 'logged_off']);

export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clerkUserId: text('clerk_user_id').notNull().unique(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    role: employeeRoleEnum('role'),
    team: text('team'),
    status: employeeStatusEnum('status').notNull().default('pending'),

    // TOTP MFA — Clerk's free tier has no MFA, so this is layered on top of Clerk's session
    // (engineering rule 9/11 flagged this as unverified; confirmed absent, see DEPENDENCIES.md).
    // mfaSecretEncrypted holds an AES-256-GCM-encrypted base32 TOTP secret (never plaintext at
    // rest), null until enrollment. mfaEnabledAt null = enrollment not yet completed; a signed-in
    // employee with role/status active but no mfaEnabledAt is routed to /mfa-setup, not /dashboard.
    mfaSecretEncrypted: text('mfa_secret_encrypted'),
    mfaEnabledAt: timestamp('mfa_enabled_at', { withTimezone: true }),
    mfaFailedAttempts: integer('mfa_failed_attempts').notNull().default(0),
    mfaLockedUntil: timestamp('mfa_locked_until', { withTimezone: true }),

    // Phase 5 step-up auth ("Approvals" — the build plan): set by re-entering the current TOTP
    // code right before a sensitive action (automation changes, granting permissions/admin
    // changes, outbound comms). A short, sliding freshness window (lib/permissions/step-up.ts),
    // not a one-time-use flag — several sensitive actions taken in quick succession shouldn't each
    // demand a fresh code.
    /**
     * Held out until this moment after repeated failed sign-ins, regardless of a valid session.
     *
     * Enforced by the Hub rather than left to Clerk because Clerk's own cooldown is a fixed
     * length — see lib/auth/lockout.ts for why each repeat has to cost more than the last.
     * Null means not locked out.
     */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),

    /**
     * How many times this account has been locked out inside the escalation window.
     *
     * Kept on the row rather than counted from history on every check, because the check runs on
     * every request through the dashboard layout. `lockoutCountResetAt` is when the window
     * started, so the count can be discarded once it has aged out instead of rising for ever and
     * eventually giving a real employee a week's lockout for one bad afternoon.
     */
    lockoutCount: integer('lockout_count').notNull().default(0),
    lockoutCountResetAt: timestamp('lockout_count_reset_at', { withTimezone: true }),

    stepUpVerifiedAt: timestamp('step_up_verified_at', { withTimezone: true }),

    // Which Clerk session produced that step-up. The timestamp alone said "this person proved it
    // was them recently" without saying *where*, so a step-up performed on the owner's own laptop
    // opened the five-minute window for every other live session on the account at the same time
    // — including a stolen one, which is the exact case step-up exists to defeat. Checked together
    // with the timestamp in lib/permissions/step-up.ts; a null here fails closed.
    stepUpSessionId: text('step_up_session_id'),

    // SYRIX AI preferences, per employee rather than per organisation — two people on the same team
    // can want answers in different languages, and one of them wanting the assistant kept away from
    // Hub records is not a decision to make on the other's behalf.
    //
    // aiLanguage: BCP-47-ish short code the answer is written in. Retrieval is unaffected — sources
    // are read in whatever language they are published in (UK immigration rules are published in
    // English), and only the answer is written in the chosen one. Storing a code rather than a name
    // keeps it stable if the display name is ever reworded.
    aiLanguage: text('ai_language').notNull().default('en'),
    // aiHubAccess: false takes away the assistant's ability to read Hub records and to propose any
    // action against them. It deliberately does NOT touch web search, page reading or research —
    // those reach nothing belonging to this business, so switching off internal access has no reason
    // to disable them.
    aiHubAccess: boolean('ai_hub_access').notNull().default(true),

    // What the Hub calls this person — the dashboard greeting and SYRIX AI's own
    // "you are talking to <name>" line — when they want something other than
    // their legal name from Clerk (a nickname, a shortened first name). Null
    // means "use `name`"; this is an override, not a second identity, so it is
    // never used anywhere permissions or the audit log key off of.
    preferredName: text('preferred_name'),

    // Live presence, not a timesheet — no history table backs this (deliberate v1 scope cut, see
    // docs/data-model.md's Team Status section). workStatusChangedAt is just "since when has the
    // current value held," read by the Teams page to show e.g. "On Break since 2:15pm".
    workStatus: workStatusEnum('work_status').notNull().default('logged_off'),
    workStatusChangedAt: timestamp('work_status_changed_at', { withTimezone: true }),

    // Line manager. A self-reference rather than a `team`-derived lookup because HR approval
    // chains do not follow the team column: leave and timesheets are approved by one named
    // person, and a team can contain several people who lead nothing. Null means "no line
    // manager set", which routes that employee's approvals to HR_ADMIN rather than to nobody.
    // set null on delete, so removing a manager's record never deletes their reports.
    managerId: uuid('manager_id').references((): AnyPgColumn => employees.id, {
      onDelete: 'set null'
    }),

    // Breathe's "finance user": access to pay figures and expense claim amounts, and nothing
    // else. A flag rather than a role because it has to compose with whatever role the person
    // already holds — a bookkeeper who is otherwise a plain EMPLOYEE, or a MANAGER who also
    // signs off spend. Modelling it as a role would force a choice between the two.
    financeAccess: boolean('finance_access').notNull().default(false),

    // HR administration, granted the same way and for the same reason as financeAccess above: a
    // flag that composes with a role rather than a role of its own.
    //
    // The HR module was originally gated entirely on role === 'HR_ADMIN'. Because an employee holds
    // exactly one role, that made HR administration mutually exclusive with platform
    // administration — and since canManageUsers() is ADMIN-only, an ADMIN who switched themselves
    // to HR_ADMIN in order to configure leave would lose the screen that grants roles, with no way
    // back. In a company small enough that one person is both, the single-role model has no correct
    // answer; this flag gives one.
    //
    // It grants HR administration and nothing else. Business-data scope still comes from the role
    // (lib/permissions/roles.ts), and SECURITY_ADMIN stays walled off from HR whatever this says,
    // because hrScopeFor() checks that first.
    hrAdmin: boolean('hr_admin').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    // "Who reports to me" is the single most-run filter in the HR module: every scoped list and
    // every per-target permission check narrows on it, and it had no index. `status` is indexed
    // alongside it because almost every one of those queries also excludes inactive accounts.
    index('employees_manager_id_idx').on(table.managerId),
    index('employees_status_idx').on(table.status),
    index('employees_team_idx').on(table.team)
  ]
);

export const auditResultEnum = pgEnum('audit_result', ['success', 'denied', 'error']);

// Append-only by convention: no update/delete helper is ever exported from lib/permissions/audit.ts.
// A DB-level immutability guarantee (restricted role or trigger) is Phase 9 hardening, not yet built —
// don't treat this table as tamper-proof until that lands.
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorEmployeeId: uuid('actor_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    result: auditResultEnum('result').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  // This table grows faster than any other — a row per privileged action, for ever — and had no
  // index at all, so every one of the three questions ever asked of it (what did this person do,
  // what happened to this record, what happened recently) was a full scan.
  (table) => [
    index('audit_log_created_at_idx').on(table.createdAt),
    index('audit_log_actor_employee_id_idx').on(table.actorEmployeeId),
    index('audit_log_resource_idx').on(table.resourceType, table.resourceId)
  ]
);

/**
 * One row the first time a given browser session reaches the Hub — who, from which device, at
 * which address.
 *
 * The audit log records what an authenticated caller *did*; nothing recorded where they came
 * from or on what, so "is that sign-in mine?" had no answer anywhere in the app. That question
 * only becomes answerable once the Hub is reachable from the public internet, which is what this
 * table is for.
 *
 * `deviceId` is a random identifier held in a signed, httpOnly cookie (lib/auth/device-cookie.ts)
 * — it identifies a browser, not a person, and carries nothing derived from the account. It is
 * deliberately not a fingerprint of the user agent or the address: both change for ordinary
 * reasons (a browser update, a train journey) and a "new device" alert that fires on those is an
 * alert nobody reads. A device the account has signed in from before is the one thing that stays
 * stable across exactly the cases that are not suspicious.
 *
 * Unique on (employeeId, clerkSessionId) so the recorder can run on every request and insert at
 * most once per sign-in, rather than needing to know whether it has already run.
 */
export const signInEvents = pgTable(
  'sign_in_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    clerkSessionId: text('clerk_session_id').notNull(),
    deviceId: text('device_id').notNull(),
    /** Whether this account had ever been seen on this device before. Drives the alert. */
    newDevice: boolean('new_device').notNull().default(false),
    /** Recorded to answer "was that me"; never used to make an access decision. */
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /** Two-letter country from the CDN's own geo header, where a CDN is in front. */
    country: text('country'),
    /** What the Hub's own gate did with this session, for the ones that never got in. */
    accountStatus: employeeStatusEnum('account_status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique('sign_in_events_session_unique').on(table.employeeId, table.clerkSessionId),
    index('sign_in_events_employee_id_idx').on(table.employeeId),
    index('sign_in_events_device_idx').on(table.employeeId, table.deviceId),
    index('sign_in_events_created_at_idx').on(table.createdAt)
  ]
);

// --- Phase 2: Core Work (docs/data-model.md, docs/permissions-matrix.md) ---

export const clientStatusEnum = pgEnum('client_status', ['active', 'inactive']);

export const projectStatusEnum = pgEnum('project_status', [
  'active',
  'on_hold',
  'completed',
  'cancelled'
]);

export const taskStatusEnum = pgEnum('task_status', ['todo', 'in_progress', 'blocked', 'done']);

export const taskPriorityEnum = pgEnum('task_priority', ['low', 'medium', 'high', 'urgent']);

// `team` is an explicit column, not derived from clientStaff/projectStaff assignment: a client
// or project's team-scoped visibility (docs/permissions-matrix.md's "TEAM_LEAD sees team's
// clients") must stay an unambiguous flat comparison even if staff assigned to it later span
// more than one team — set at creation (defaults to the creator's team), ADMIN can reassign it.
export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    serviceLine: text('service_line'),
    team: text('team').notNull(),
    status: clientStatusEnum('status').notNull().default('active'),
    // Phase 5: set by the client-inactivity-follow-up automation's periodic scan so a client
    // already flagged isn't renotified again until a fresh inactivity window has passed —
    // mirrors tasks.lastReminderSentAt's cooldown role.
    lastInactivityNotifiedAt: timestamp('last_inactivity_notified_at', { withTimezone: true }),
    // Set only by scripts/seed-dev-data.ts. Lets the dashboard show realistic-looking demo names
    // (rather than a visible "Test ..." prefix) while keeping seed rows unambiguously identifiable
    // at the database level and safely re-runnable/wipeable — engineering rule 7 still requires
    // fake data to be labelled, just not necessarily in the name shown on screen.
    isSeedData: boolean('is_seed_data').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('clients_team_idx').on(table.team)]
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    team: text('team').notNull(),
    status: projectStatusEnum('status').notNull().default('active'),
    // See clients.isSeedData.
    isSeedData: boolean('is_seed_data').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('projects_client_id_idx').on(table.clientId),
    index('projects_team_idx').on(table.team)
  ]
);

// Minimal Phase 2 version — a real table (not a jsonb blob) since milestone due dates need
// indexing once the Phase 5 Timeline view queries across them. Full milestone UI is Phase 5.
export const projectMilestones = pgTable(
  'project_milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    dueDate: timestamp('due_date', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // Phase 5: set by the project-deadline-reminder automation, same cooldown role as
    // tasks.lastReminderSentAt — a milestone already reminded isn't nagged again within the
    // ~20-hour resend guard the scan uses.
    lastReminderSentAt: timestamp('last_reminder_sent_at', { withTimezone: true }),
    // See clients.isSeedData.
    isSeedData: boolean('is_seed_data').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('project_milestones_project_id_idx').on(table.projectId)]
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    description: text('description'),
    status: taskStatusEnum('status').notNull().default('todo'),
    priority: taskPriorityEnum('priority').notNull().default('medium'),
    dueDate: timestamp('due_date', { withTimezone: true }),
    // Soft-deleted/archived tasks are never hard-deleted, to preserve audit history.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // The task's own team — independent of who it's currently assigned to. Needed so a
    // TEAM_LEAD can see and triage a not-yet-assigned task for their team (assigneeId is null
    // until someone picks it up, so scoping by assignee's team alone would make an unassigned
    // task invisible to the team meant to be working it). Set at creation (defaults to the
    // creator's team), ADMIN can reassign it.
    team: text('team').notNull(),
    assigneeId: uuid('assignee_id').references(() => employees.id, { onDelete: 'set null' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    // Phase 3: date-only marker (not a timestamp comparison) so the daily due-date reminder scan
    // sends at most one reminder per calendar day per task, regardless of what time it runs at.
    lastReminderSentAt: timestamp('last_reminder_sent_at', { withTimezone: true }),
    // Phase 5: a subtask is a full Task row, not a lighter parallel model — it has its own
    // assignee/status/priority/due date and goes through the same permission/scope checks as any
    // other task. Cascades because a subtask's identity is meaningless without its parent (unlike
    // client/project links, which set null — a task never outlives the parent it's a part of).
    parentTaskId: uuid('parent_task_id').references((): AnyPgColumn => tasks.id, {
      onDelete: 'cascade'
    }),
    // Phase 5 recurrence: { frequency: 'daily' | 'weekly' | 'monthly', interval: number } — null
    // means "not recurring". Completing a task with a rule generates the next occurrence
    // (features/tasks/actions.ts) rather than this row itself repeating.
    recurrenceRule: jsonb('recurrence_rule'),
    // Set on a generated occurrence, pointing back at the first task in its recurring series (not
    // just its immediate predecessor) — set null on delete since the series' history shouldn't
    // vanish if the original task row is ever removed.
    recurrenceOfTaskId: uuid('recurrence_of_task_id').references((): AnyPgColumn => tasks.id, {
      onDelete: 'set null'
    }),
    // See clients.isSeedData.
    isSeedData: boolean('is_seed_data').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('tasks_assignee_id_idx').on(table.assigneeId),
    index('tasks_client_id_idx').on(table.clientId),
    index('tasks_project_id_idx').on(table.projectId),
    index('tasks_due_date_idx').on(table.dueDate),
    index('tasks_status_idx').on(table.status),
    index('tasks_team_idx').on(table.team),
    index('tasks_parent_task_id_idx').on(table.parentTaskId)
  ]
);

// --- Phase 3: Events, Queue & First Automations (docs/data-model.md, docs/permissions-matrix.md) ---

export const enquirySourceEnum = pgEnum('enquiry_source', ['manual', 'email']);

export const enquiryStatusEnum = pgEnum('enquiry_status', [
  'new',
  'in_progress',
  'awaiting_response',
  'responded',
  'closed'
]);

// 'source' distinguishes Phase 3's manual entry from Phase 4's real email intake, which will
// create rows here too once it exists — manual entry is also exactly the "manual enquiry entry
// still works" degrade-path the build plan requires of the email integration once it's built.
export const enquiries = pgTable(
  'enquiries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: enquirySourceEnum('source').notNull().default('manual'),
    contactName: text('contact_name').notNull(),
    contactEmail: text('contact_email').notNull(),
    message: text('message'),
    // Same creator-defaults/ADMIN-reassign pattern as Client/Project/Task's own `team` column.
    team: text('team').notNull(),
    status: enquiryStatusEnum('status').notNull().default('new'),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    // Nullable as of Phase 4: an email-detected enquiry (source: 'email') has no acting
    // employee — it's created by the Hostinger Mail webhook/reconciliation path, not a Server
    // Action with a caller. Manual enquiries (source: 'manual') still always set this.
    createdBy: uuid('created_by').references(() => employees.id),
    // See clients.isSeedData.
    isSeedData: boolean('is_seed_data').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('enquiries_team_idx').on(table.team),
    index('enquiries_status_idx').on(table.status),
    // A client page lists the enquiries filed against that client.
    index('enquiries_client_id_idx').on(table.clientId)
  ]
);

// One row per automation definition, not per run — see automationRuns for run history.
export const automations = pgTable('automations', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Stable identifier automation code refers to directly (e.g. 'new-enquiry') — never shown
  // raw to users, `name`/`description` are for that.
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  triggerEvent: text('trigger_event').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  ownerEmployeeId: uuid('owner_employee_id').references(() => employees.id, {
    onDelete: 'set null'
  }),
  // e.g. { "followUpAfterDays": 3 } — the one piece of per-automation config the build plan
  // requires ("no-response follow-up after N configurable days").
  config: jsonb('config'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const automationRunStatusEnum = pgEnum('automation_run_status', [
  'queued',
  'running',
  'success',
  'failed',
  'skipped'
]);

export const automationRuns = pgTable(
  'automation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    automationId: uuid('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    status: automationRunStatusEnum('status').notNull().default('queued'),
    triggerResourceType: text('trigger_resource_type'),
    triggerResourceId: text('trigger_resource_id'),
    error: text('error'),
    result: jsonb('result'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('automation_runs_automation_id_idx').on(table.automationId),
    index('automation_runs_status_idx').on(table.status),
    index('automation_runs_created_at_idx').on(table.createdAt)
  ]
);

// Singleton row (fixed text PK, not uuid) for the one master kill-switch required by
// the build plan Phase 3 — guarantees exactly one row ever exists.
export const automationSettings = pgTable('automation_settings', {
  id: text('id').primaryKey().default('singleton'),
  killSwitchEnabled: boolean('kill_switch_enabled').notNull().default(true),
  updatedByEmployeeId: uuid('updated_by_employee_id').references(() => employees.id, {
    onDelete: 'set null'
  }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    // e.g. 'task_assigned' | 'task_due_soon' | 'enquiry_task_created' | 'follow_up_due' |
    // 'automation_failed' — free text, not an enum: this list is expected to grow every phase
    // that adds a new notification-worthy event, and an enum migration per addition is pure
    // friction for no safety benefit (nothing enforces exhaustiveness across notification types).
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('notifications_employee_id_idx').on(table.employeeId),
    index('notifications_read_at_idx').on(table.readAt)
  ]
);

export const clientStaff = pgTable(
  'client_staff',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('client_staff_client_id_idx').on(table.clientId),
    index('client_staff_employee_id_idx').on(table.employeeId),
    unique('client_staff_client_employee_unique').on(table.clientId, table.employeeId)
  ]
);

export const projectStaff = pgTable(
  'project_staff',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('project_staff_project_id_idx').on(table.projectId),
    index('project_staff_employee_id_idx').on(table.employeeId),
    unique('project_staff_project_employee_unique').on(table.projectId, table.employeeId)
  ]
);

// --- Phase 4: Integrations (docs/data-model.md, docs/permissions-matrix.md) ---

export const integrationStatusEnum = pgEnum('integration_status', [
  'not_configured',
  'connected',
  'error'
]);

// One row per external system this Hub integrates with, seeded when that integration's code
// ships (see migration 0006's seed insert) — Google Calendar has no row yet since it isn't
// built, deliberately, rather than seeding a row nothing manages.
export const integrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  status: integrationStatusEnum('status').notNull().default('not_configured'),
  ownerEmployeeId: uuid('owner_employee_id').references(() => employees.id, {
    onDelete: 'set null'
  }),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastError: text('last_error'),
  // Non-secret settings only (e.g. mailboxResourceId). Secrets (API tokens, webhook bearer
  // tokens) live in credentialsEncrypted below, never here — this column gets read straight
  // back into server components and must never carry anything sensitive.
  config: jsonb('config'),
  // AES-256-GCM ciphertext of a JSON blob of secrets, same construction as
  // employees.mfaSecretEncrypted (see lib/integrations/crypto.ts) — never plaintext at rest.
  credentialsEncrypted: text('credentials_encrypted'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const connectorKindEnum = pgEnum('connector_kind', [
  /** A Model Context Protocol server, reached over HTTP and verified with a real handshake. */
  'mcp',
  /** A plain HTTP API behind a bearer token or API key header. */
  'http_api'
]);

export const connectorStatusEnum = pgEnum('connector_status', [
  /** Saved but never successfully reached. */
  'unverified',
  /** The last check reached it and it answered correctly. */
  'connected',
  /** The last check failed; `lastError` says how. */
  'error'
]);

/**
 * An outside service someone at the organisation connected, as opposed to `integrations` above.
 *
 * The two are deliberately separate. An `integrations` row exists because this codebase contains
 * an adapter for that specific system — it is seeded by a migration when that adapter ships, and
 * its key is referenced by code. A connector is created by a person at runtime for a service this
 * codebase knows nothing about in particular, and is reached generically. Putting both in one
 * table would mean a user-created row could collide with a key the code expects to find.
 *
 * `credentialsEncrypted` holds AES-256-GCM ciphertext, the same construction as
 * `integrations.credentialsEncrypted` and `employees.mfaSecretEncrypted` — never plaintext at
 * rest, and never returned to the browser once saved. `config` is for non-secret settings only,
 * because it is read straight into server components.
 *
 * Everything reached through a connector is untrusted input (engineering rule 12). A tool
 * description or a response body arriving from one is data to be shown, never an instruction to
 * be followed.
 */
export const connectors = pgTable(
  'connectors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: connectorKindEnum('kind').notNull(),
    name: text('name').notNull(),
    /**
     * Which catalogue entry this is, when it is one — 'slack', 'notion', and so on. Null for a
     * connector someone added by hand. Not unique: two Slack workspaces are two connectors.
     */
    catalogueKey: text('catalogue_key'),
    baseUrl: text('base_url').notNull(),

    enabled: boolean('enabled').notNull().default(true),
    status: connectorStatusEnum('status').notNull().default('unverified'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastError: text('last_error'),

    config: jsonb('config'),
    credentialsEncrypted: text('credentials_encrypted'),

    createdByEmployeeId: uuid('created_by_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('connectors_catalogue_key_idx').on(table.catalogueKey),
    unique('connectors_name_unique').on(table.name)
  ]
);

export const emailActivityDirectionEnum = pgEnum('email_activity_direction', [
  'inbound',
  'outbound'
]);

// A lightweight activity ledger, not a full mail mirror — Hostinger Mail stays the source of
// truth for message content (engineering rule 2 — external systems stay authoritative for
// their own data); this just records enough to link a thread to a client/project/enquiry and
// show it on their pages. Full message content is fetched live from the Mail API when needed.
export const emailActivity = pgTable(
  'email_activity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    direction: emailActivityDirectionEnum('direction').notNull(),
    externalMessageId: text('external_message_id').notNull(),
    mailboxResourceId: text('mailbox_resource_id').notNull(),
    fromAddress: text('from_address').notNull(),
    toAddresses: jsonb('to_addresses').notNull(),
    subject: text('subject'),
    snippet: text('snippet'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    enquiryId: uuid('enquiry_id').references(() => enquiries.id, { onDelete: 'set null' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('email_activity_enquiry_id_idx').on(table.enquiryId),
    index('email_activity_client_id_idx').on(table.clientId),
    index('email_activity_project_id_idx').on(table.projectId),
    index('email_activity_occurred_at_idx').on(table.occurredAt),
    unique('email_activity_mailbox_external_message_unique').on(
      table.mailboxResourceId,
      table.externalMessageId
    )
  ]
);

// Generic across every integration, not just email — a failed webhook delivery or reconciliation
// pass lands here instead of throwing, so "dead-letter queue for failed processing"
// (the build plan Phase 4) has one real place to look regardless of which system failed.
export const deadLetterJobs = pgTable(
  'dead_letter_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(),
    payload: jsonb('payload'),
    error: text('error').notNull(),
    failedAt: timestamp('failed_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByEmployeeId: uuid('resolved_by_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    })
  },
  (table) => [
    index('dead_letter_jobs_source_idx').on(table.source),
    index('dead_letter_jobs_resolved_at_idx').on(table.resolvedAt)
  ]
);

export const documentLinkSystemEnum = pgEnum('document_link_system', [
  'sharepoint',
  'onedrive',
  'nas',
  'other'
]);
export const documentLinkCheckStatusEnum = pgEnum('document_link_check_status', [
  'unknown',
  'ok',
  'broken'
]);

// Reference-only per the build plan Phase 4 — Hub never stores the file itself or a storage
// credential, only a link + label and whether that link was last reachable. Exactly one of
// clientId/projectId is set (enforced in features/document-links/utils/schemas.ts), matching how
// a document belongs to one client or one project, never both and never neither. A failed
// reachability check only ever updates lastCheckStatus — the row itself is never removed, so a
// broken link never means a lost record (the build plan's explicit failure-behavior requirement).
// taskId added Phase 5: a task's "attachments" (the build plan) are the same reference-only
// concept as a client/project's document links — reused rather than building a parallel entity
// (engineering rule 8). Exactly one of clientId/projectId/taskId is set (enforced in
// features/document-links/utils/schemas.ts's refine, not a DB constraint, same as before).
export const documentLinks = pgTable(
  'document_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    label: text('label').notNull(),
    url: text('url').notNull(),
    system: documentLinkSystemEnum('system').notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    addedByEmployeeId: uuid('added_by_employee_id')
      .notNull()
      .references(() => employees.id),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastCheckStatus: documentLinkCheckStatusEnum('last_check_status').notNull().default('unknown'),
    lastCheckError: text('last_check_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('document_links_client_id_idx').on(table.clientId),
    index('document_links_project_id_idx').on(table.projectId),
    index('document_links_task_id_idx').on(table.taskId),
    // The Documents page lists the newest links across everything the caller can see, which
    // without this is a sequential scan sorted in memory on the one table that grows with every
    // client, project and task in the company.
    index('document_links_created_at_idx').on(table.createdAt)
  ]
);

/**
 * A business document held by the Hub itself, as opposed to `documentLinks` above, which only
 * records where a file lives in someone else's system.
 *
 * Both exist deliberately and the Documents page shows them together. A link keeps SharePoint or
 * the NAS authoritative, which is engineering rule 2's rule and the right answer for anything
 * the firm already manages there. An upload is for the case that rule does not cover: a document
 * that has no home anywhere else and would otherwise live in somebody's inbox.
 *
 * Metadata only, the same convention as `messageAttachments` and `hrDocuments` — the bytes are in
 * object storage under `storageKey` (lib/storage/), never in Postgres and never routed through
 * this server.
 *
 * Scoping is `team`, copying clients/projects/tasks rather than inventing a fourth rule. Where a
 * document is attached to a client, project or task, that parent decides access instead, so a
 * document can never be more visible than the record it belongs to.
 */
export const documentFiles = pgTable(
  'document_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    description: text('description'),

    storageKey: text('storage_key').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),

    // Set at upload from the uploader's team, ADMIN-reassignable — the same arrangement as
    // clients.team, and for the same reason: team-scoped visibility has to be one flat
    // comparison rather than something derived from staffing that can span teams.
    team: text('team').notNull(),

    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),

    uploadedByEmployeeId: uuid('uploaded_by_employee_id')
      .notNull()
      .references(() => employees.id),

    // Archived rather than deleted, matching hrDocuments: a document referenced from a client
    // record that silently vanishes is worse than one visibly withdrawn. The stored object is
    // left in place; real deletion belongs with the retention policy still to be written
    // (docs/data-classification.md).
    archivedAt: timestamp('archived_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('document_files_team_idx').on(table.team),
    index('document_files_client_id_idx').on(table.clientId),
    index('document_files_project_id_idx').on(table.projectId),
    index('document_files_task_id_idx').on(table.taskId),
    index('document_files_created_at_idx').on(table.createdAt)
  ]
);

// --- Phase 5: Full Workflows (docs/data-model.md, docs/permissions-matrix.md) ---

// A flat, single checklist per task (not named/grouped checklists) — the build plan's "checklists"
// requirement is met by a lightweight tick-list; a full second task model would duplicate what
// Subtasks (tasks.parentTaskId, above) already cover for anything that needs its own
// assignee/status/due date.
export const checklistItems = pgTable(
  'checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    done: boolean('done').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('checklist_items_task_id_idx').on(table.taskId)]
);

export const taskComments = pgTable(
  'task_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    // set null (not cascade) — a comment is part of the task's history and should survive the
    // author later being removed as an employee, same rationale as auditLog.actorEmployeeId.
    authorEmployeeId: uuid('author_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('task_comments_task_id_idx').on(table.taskId),
    index('task_comments_created_at_idx').on(table.createdAt)
  ]
);

// A watcher opts in to notifications about a task without needing edit access to it — same
// "own" bar as canViewTask, not canEditTask (features/tasks/actions.ts).
export const taskWatchers = pgTable(
  'task_watchers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('task_watchers_task_id_idx').on(table.taskId),
    index('task_watchers_employee_id_idx').on(table.employeeId),
    unique('task_watchers_task_employee_unique').on(table.taskId, table.employeeId)
  ]
);

// taskId "depends on" dependsOnTaskId — taskId cannot be considered unblocked until
// dependsOnTaskId is done. Cycle prevention (A depends on B depends on A) is enforced in
// features/tasks/actions.ts at insert time via a graph walk, not a DB constraint — the same
// division of responsibility as document_links' "exactly one of" rule.
export const taskDependencies = pgTable(
  'task_dependencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    dependsOnTaskId: uuid('depends_on_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('task_dependencies_task_id_idx').on(table.taskId),
    index('task_dependencies_depends_on_task_id_idx').on(table.dependsOnTaskId),
    unique('task_dependencies_task_depends_on_unique').on(table.taskId, table.dependsOnTaskId)
  ]
);

// --- Phase 5: native Calendar ---
//
// Google Calendar sync (the build plan Phase 4) is still deferred — no OAuth app configured, no
// `integrations` row seeded for it. SYRIX Forma still needs a working calendar in the meantime, so
// this is a real, SYRIX Forma-owned entity (source of truth per engineering rule 2), not a stub
// waiting on that integration. When Google/Outlook sync is eventually built, it becomes a second
// writer into this same table (an `externalId`/`source` pair, the same shape EmailActivity uses
// to de-duplicate a redelivered webhook) rather than a separate parallel calendar.
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    description: text('description'),
    location: text('location'),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    allDay: boolean('all_day').notNull().default(false),
    // Same creator-defaults/ADMIN-reassign pattern as Task/Client/Project/Enquiry's own `team`.
    team: text('team').notNull(),
    createdByEmployeeId: uuid('created_by_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    // Optional link so a client/project page can show its own upcoming meetings (Phase 5's
    // "Client Centre, expanded"). Exactly one of these may be set, enforced in
    // features/calendar/utils/schemas.ts, same convention as document_links.
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    // See clients.isSeedData.
    isSeedData: boolean('is_seed_data').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('calendar_events_start_at_idx').on(table.startAt),
    index('calendar_events_team_idx').on(table.team),
    index('calendar_events_client_id_idx').on(table.clientId),
    index('calendar_events_project_id_idx').on(table.projectId)
  ]
);

// An event's "own" scope (lib/permissions/calendar-access.ts) is creator-or-attendee, mirroring
// how Client/Project's "own" scope is staff membership (client_staff/project_staff) rather than a
// single assignee — an event can involve several people at once, same shape.
export const calendarEventAttendees = pgTable(
  'calendar_event_attendees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => calendarEvents.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('calendar_event_attendees_event_id_idx').on(table.eventId),
    index('calendar_event_attendees_employee_id_idx').on(table.employeeId),
    unique('calendar_event_attendees_event_employee_unique').on(table.eventId, table.employeeId)
  ]
);

// --- Phase 5: Client Centre, expanded ---

// Freeform notes on a client, same shape as task_comments — view requires canViewClient, editing/
// removing your own note requires authorship, not a role check (features/clients/notes-actions.ts).
export const clientNotes = pgTable(
  'client_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    authorEmployeeId: uuid('author_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('client_notes_client_id_idx').on(table.clientId),
    index('client_notes_created_at_idx').on(table.createdAt)
  ]
);

// --- Phase 5: project templates per service line ---

// Company-wide reusable patterns, not team-scoped business data — same TEAM_LEAD+ tier that
// already gates creating a project at all (features/projects/actions.ts's createProject).
export const projectTemplates = pgTable(
  'project_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    serviceLine: text('service_line'),
    createdByEmployeeId: uuid('created_by_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('project_templates_service_line_idx').on(table.serviceLine)]
);

// relativeDueDays (nullable = no due date) is measured from the chosen project start date at
// creation time (features/project-templates/actions.ts's createProjectFromTemplate computes the
// real due_date then) — the template itself never stores an absolute date.
export const projectTemplateTasks = pgTable(
  'project_template_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => projectTemplates.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    priority: taskPriorityEnum('priority').notNull().default('medium'),
    relativeDueDays: integer('relative_due_days'),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('project_template_tasks_template_id_idx').on(table.templateId)]
);

export const projectTemplateMilestones = pgTable(
  'project_template_milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => projectTemplates.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    relativeDueDays: integer('relative_due_days'),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('project_template_milestones_template_id_idx').on(table.templateId)]
);

// --- Team Chat (added post-Phase-6, docs/data-model.md, docs/permissions-matrix.md) ---
//
// Deliberately no `team` column and no role/scope tier anywhere in this section — unlike
// every other resource above, Chat access is purely "are you a participant of this
// conversation" (lib/permissions/chat-access.ts), enforced the same way for every role
// including ADMIN.

export const conversationTypeEnum = pgEnum('conversation_type', ['dm', 'group']);

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: conversationTypeEnum('type').notNull(),
  // Nullable — a DM is named from its participants at render time, never stored redundantly.
  name: text('name'),
  createdByEmployeeId: uuid('created_by_employee_id').references(() => employees.id, {
    onDelete: 'set null'
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    // Drives the unread-count badge — updated by markConversationRead, not on every message
    // fetch, so opening a thread without explicitly marking it read doesn't clear the badge.
    lastReadAt: timestamp('last_read_at', { withTimezone: true })
  },
  (table) => [
    index('conversation_participants_conversation_id_idx').on(table.conversationId),
    index('conversation_participants_employee_id_idx').on(table.employeeId),
    unique('conversation_participants_conversation_employee_unique').on(
      table.conversationId,
      table.employeeId
    )
  ]
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    // set null (not cascade) — same "message survives the author being removed" convention as
    // taskComments.authorEmployeeId / clientNotes.authorEmployeeId.
    authorEmployeeId: uuid('author_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true })
  },
  (table) => [
    index('messages_conversation_id_created_at_idx').on(table.conversationId, table.createdAt)
  ]
);

// Metadata only — never the file itself, same reference-only convention as documentLinks. The
// bytes live in object storage (lib/storage/), keyed by storageKey; see DEPENDENCIES.md.
export const messageAttachments = pgTable(
  'message_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('message_attachments_message_id_idx').on(table.messageId)]
);

// --- HR: people records (docs/data-model.md, docs/permissions-matrix.md,
//     docs/data-classification.md) ---
//
// Everything below this line is HR data, and HR data does not follow the team-scope rule the
// rest of this schema uses. A TEAM_LEAD legitimately sees their team's tasks; they must never
// see a colleague's date of birth, salary or sickness detail. Access is decided in
// lib/permissions/hr-access.ts, which keys off employees.managerId and the HR_ADMIN role —
// never off scopeForBusinessData. Do not add a `team` column to these tables: it would invite
// exactly the wrong check.
//
// Most of these columns are special category or financial personal data under UK GDPR.
// docs/data-classification.md classifies them field by field; read it before adding a column
// here or exposing one to a new caller.

export const contractTypeEnum = pgEnum('employment_contract_type', [
  'permanent',
  'fixed_term',
  'part_time',
  'apprentice',
  'contractor',
  'intern'
]);

// One row per employee, holding the identity and employment detail the employees row itself
// deliberately does not carry. Split from `employees` rather than added to it because
// `employees` is read on effectively every request (current-employee.ts) by every role, and
// widening that row with special category data would put it one careless `select()` away from
// every screen in the app. A separate table makes reading it a deliberate act.
export const employeeProfiles = pgTable(
  'employee_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),

    dateOfBirth: date('date_of_birth'),
    // Stored encrypted — a National Insurance number is a lifelong government identifier and
    // is never needed for display, only for payroll export. lib/hr/crypto.ts.
    nationalInsuranceEncrypted: text('national_insurance_encrypted'),
    personalEmail: text('personal_email'),
    personalPhone: text('personal_phone'),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    addressCity: text('address_city'),
    addressPostcode: text('address_postcode'),
    addressCountry: text('address_country'),

    emergencyContactName: text('emergency_contact_name'),
    emergencyContactRelationship: text('emergency_contact_relationship'),
    emergencyContactPhone: text('emergency_contact_phone'),

    jobTitle: text('job_title'),
    contractType: contractTypeEnum('contract_type'),
    startDate: date('start_date'),
    probationEndDate: date('probation_end_date'),
    // Set when someone leaves. The employees row moves to 'disabled' separately — this is the
    // HR record of when employment ended, which payroll and reporting need long after the
    // account itself is switched off.
    endDate: date('end_date'),
    leavingReason: text('leaving_reason'),

    // Contracted days per week and hours per week, used to pro-rata leave allowance for
    // part-time staff. Nullable: unset means "use the company default" rather than zero.
    workingDaysPerWeek: integer('working_days_per_week'),
    workingHoursPerWeek: integer('working_hours_per_week'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique('employee_profiles_employee_id_unique').on(table.employeeId)]
);

export const payFrequencyEnum = pgEnum('pay_frequency', ['monthly', 'four_weekly', 'weekly']);

// Pay and bank detail, split out again from employee_profiles for the same reason profiles is
// split from employees: this is the narrowest, most sensitive table in the schema, and the
// only one HR_ADMIN and finance users can reach. Amounts and bank details are encrypted at
// rest via lib/hr/crypto.ts, which derives its own HKDF domain from the single master secret
// (lib/auth/mfa-keys.ts) so a compromise of the integration-credentials key does not also
// expose payroll.
//
// Amounts are encrypted text rather than numeric, which means the database cannot sum or sort
// them. That is a deliberate trade: payroll totals are computed in the export path after
// decryption, and no screen needs to rank employees by salary.
export const employeePay = pgTable(
  'employee_pay',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),

    annualSalaryEncrypted: text('annual_salary_encrypted'),
    hourlyRateEncrypted: text('hourly_rate_encrypted'),
    currency: text('currency').notNull().default('GBP'),
    payFrequency: payFrequencyEnum('pay_frequency'),

    bankAccountNameEncrypted: text('bank_account_name_encrypted'),
    bankSortCodeEncrypted: text('bank_sort_code_encrypted'),
    bankAccountNumberEncrypted: text('bank_account_number_encrypted'),

    // Who last changed pay and when — a salary change is the single most disputed field in an
    // HR system, and the audit_log entry alone is not convenient enough to show on the record.
    effectiveFrom: date('effective_from'),
    updatedByEmployeeId: uuid('updated_by_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique('employee_pay_employee_id_unique').on(table.employeeId)]
);

export const customFieldTypeEnum = pgEnum('hr_custom_field_type', [
  'text',
  'number',
  'date',
  'select',
  'checkbox'
]);

// Breathe's "custom fields": business-specific columns HR can add without a migration.
// Definition and value are separate tables so that renaming a field, or removing it, does not
// require touching every employee's row.
export const employeeCustomFields = pgTable(
  'employee_custom_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    fieldType: customFieldTypeEnum('field_type').notNull(),
    // Only meaningful for 'select' — the allowed options, as a JSON array of strings.
    options: jsonb('options'),
    // Whether the employee can see this field on their own record. Defaults false: a field HR
    // invents (e.g. a performance note) should not become self-visible by accident.
    visibleToEmployee: boolean('visible_to_employee').notNull().default(false),
    position: integer('position').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique('employee_custom_fields_name_unique').on(table.name)]
);

export const employeeCustomFieldValues = pgTable(
  'employee_custom_field_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fieldId: uuid('field_id')
      .notNull()
      .references(() => employeeCustomFields.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    // Held as text regardless of the field's declared type, parsed on read against that type.
    // A per-type column set would mean five mostly-null columns per row.
    value: text('value'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('employee_custom_field_values_employee_id_idx').on(table.employeeId),
    unique('employee_custom_field_values_field_employee_unique').on(table.fieldId, table.employeeId)
  ]
);

// Training history, qualifications and — the part that earns this table its place — expiry
// dates. A first aid certificate or a professional licence that lapses unnoticed is the
// failure this exists to prevent, so expiresAt is indexed for the reminder sweep that reads
// it rather than being a display-only field.
export const employeeTrainingRecords = pgTable(
  'employee_training_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    provider: text('provider'),
    notes: text('notes'),
    completedOn: date('completed_on'),
    expiresOn: date('expires_on'),
    // How many days before expiry the reminder fires. Null uses the company default.
    reminderLeadDays: integer('reminder_lead_days'),
    // Set when the expiry reminder has been sent, so the sweep is idempotent and does not
    // re-notify on every run — same shape as the automation run guards.
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('employee_training_records_employee_id_idx').on(table.employeeId),
    index('employee_training_records_expires_on_idx').on(table.expiresOn)
  ]
);

// --- HR: time off and absence ---
//
// Leave is measured in whole and half days, and every duration column below is an INTEGER
// COUNT OF HALF DAYS, never a decimal number of days. Storing 12.5 days as a float invites
// rounding drift once balances are added and subtracted across a year, and storing it as
// `numeric` returns a string from the driver that every caller then has to parse. Half-days
// are exact, sortable, and summable in SQL. `lib/hr/leave-calculation.ts` owns the conversion
// for display — no screen should divide by two itself.

export const leaveUnitEnum = pgEnum('leave_day_unit', ['full', 'am', 'pm']);

export const leaveRequestStatusEnum = pgEnum('leave_request_status', [
  'pending',
  'approved',
  'declined',
  'cancelled'
]);

// The kinds of leave the organisation recognises. Seeded with a standard UK set and editable by HR rather
// than hard-coded, because which categories a business tracks is a policy decision — statutory
// leave types change, and a new one should not need a migration.
export const leaveTypes = pgTable(
  'leave_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    // Whether taking this leave draws down the employee's annual allowance. Unpaid leave and
    // compassionate leave typically do not; holiday does. This is the flag that decides whether
    // a request touches the balance at all.
    deductsFromAllowance: boolean('deducts_from_allowance').notNull().default(true),
    isPaid: boolean('is_paid').notNull().default(true),
    // Whether a request needs a decision, or is recorded and immediately approved. Some
    // employers self-certify certain categories.
    requiresApproval: boolean('requires_approval').notNull().default(true),
    // Hex colour for the wall planner. Stored rather than derived so HR controls it.
    colour: text('colour'),
    position: integer('position').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique('leave_types_name_unique').on(table.name)]
);

// Company-wide leave policy. A single row, enforced by the `singleton` check column rather
// than by convention — a second row here would silently change everyone's entitlement, and a
// unique constraint on a constant is the cheapest way to make that impossible.
export const leaveSettings = pgTable(
  'leave_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    singleton: boolean('singleton').notNull().default(true),
    // Which calendar day the leave year starts on. 1 April is the common UK default; 1 January
    // is the other. Stored as month/day rather than a full date because it recurs.
    leaveYearStartMonth: integer('leave_year_start_month').notNull().default(1),
    leaveYearStartDay: integer('leave_year_start_day').notNull().default(1),
    // Default full-time entitlement, in half days. 25 days = 50.
    defaultEntitlementHalfDays: integer('default_entitlement_half_days').notNull().default(50),
    // Maximum that may be carried into the next leave year, in half days. 0 disables carry-over.
    carryOverMaxHalfDays: integer('carry_over_max_half_days').notNull().default(10),
    // How long carried-over leave survives into the new year before it lapses.
    carryOverExpiryMonths: integer('carry_over_expiry_months').notNull().default(3),
    // Whether a request that would take the balance below zero is refused outright.
    allowNegativeBalance: boolean('allow_negative_balance').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique('leave_settings_singleton_unique').on(table.singleton)]
);

// Per employee, per leave year. Kept as a row rather than computed from the settings defaults
// so that an individual's entitlement can differ (a part-timer's pro-rata figure, a negotiated
// extra week, a mid-year starter) without that difference living in someone's memory.
export const leaveAllowances = pgTable(
  'leave_allowances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    // The first day of the leave year this allowance covers. Identifies the year without
    // needing a separate leave_years table.
    leaveYearStart: date('leave_year_start').notNull(),
    entitlementHalfDays: integer('entitlement_half_days').notNull(),
    carriedOverHalfDays: integer('carried_over_half_days').notNull().default(0),
    // Manual correction, positive or negative — a TOIL award, a correction after a mistake.
    // Separate from entitlement so the adjustment stays visible instead of being folded in.
    adjustmentHalfDays: integer('adjustment_half_days').notNull().default(0),
    adjustmentNote: text('adjustment_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('leave_allowances_employee_id_idx').on(table.employeeId),
    unique('leave_allowances_employee_year_unique').on(table.employeeId, table.leaveYearStart)
  ]
);

export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'restrict' }),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    // Half-day support at each end of the range: a request can start on the afternoon of the
    // 3rd and end on the morning of the 7th. 'full' on both is an ordinary whole-day request.
    startUnit: leaveUnitEnum('start_unit').notNull().default('full'),
    endUnit: leaveUnitEnum('end_unit').notNull().default('full'),
    // Computed at submission from the working-day calendar in force at that moment, then
    // stored. Deliberately not recomputed on read: if a public holiday is added later, an
    // already-approved request must not silently change length after the fact.
    totalHalfDays: integer('total_half_days').notNull(),
    status: leaveRequestStatusEnum('status').notNull().default('pending'),
    reason: text('reason'),
    decidedByEmployeeId: uuid('decided_by_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    // True when an approval rule approved this without a human decision, so the audit trail
    // distinguishes "nobody objected" from "a manager looked at it".
    autoApproved: boolean('auto_approved').notNull().default(false),
    // The all-day event written into the shared calendar on approval, so approved leave shows
    // up on the Calendar tab rather than living in a parallel HR-only calendar. Nulled when the
    // request is cancelled and the event removed.
    calendarEventId: uuid('calendar_event_id').references(() => calendarEvents.id, {
      onDelete: 'set null'
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('leave_requests_employee_id_idx').on(table.employeeId),
    index('leave_requests_status_idx').on(table.status),
    // The wall planner and the overlap check both query by date range across everyone.
    index('leave_requests_start_date_idx').on(table.startDate),
    index('leave_requests_end_date_idx').on(table.endDate),
    // Every balance and every list joins this table to leave_types to find out whether a request
    // draws down the allowance, so the join column is read on every leave query there is.
    index('leave_requests_leave_type_id_idx').on(table.leaveTypeId)
  ]
);

// Bank and public holidays. Not hard-coded: the England and Wales dates move every year, the organisation
// may employ people under a different regional calendar, and a company closure day is the same
// kind of thing. Seeded for the current and next year, editable by HR.
export const publicHolidays = pgTable(
  'public_holidays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    date: date('date').notNull(),
    name: text('name').notNull(),
    // Free text rather than an enum — the set of regions the organisation cares about is a business fact
    // that will change, and an enum would need a migration each time.
    region: text('region').notNull().default('England and Wales'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('public_holidays_date_idx').on(table.date),
    unique('public_holidays_date_region_unique').on(table.date, table.region)
  ]
);

// --- HR: sickness and absence ---
//
// Health data is special category data under UK GDPR Article 9. `docs/data-classification.md`
// puts the reason/notes fields in the HIGHLY CONFIDENTIAL tier: a line manager can see THAT
// someone was absent and for how long, because they need to manage the work, but the medical
// detail is HR-only. That split is enforced in lib/permissions/hr-access.ts, not here.

export const sicknessRecords = pgTable(
  'sickness_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    startDate: date('start_date').notNull(),
    // Null means the absence is still open — the person has not returned yet. This is why the
    // table cannot simply store a duration: most sickness is recorded before its end is known.
    endDate: date('end_date'),
    // Working days lost, in half days, filled in when the absence is closed.
    totalHalfDays: integer('total_half_days'),
    // Category (e.g. "Musculoskeletal", "Mental health") — HIGHLY CONFIDENTIAL, HR only.
    category: text('category'),
    notes: text('notes'),
    isSelfCertified: boolean('is_self_certified').notNull().default(true),
    // Fit note, held in object storage like every other file in this app — the bytes never sit
    // in the database. Same reference-only convention as message_attachments.
    fitNoteStorageKey: text('fit_note_storage_key'),
    fitNoteFileName: text('fit_note_file_name'),
    recordedByEmployeeId: uuid('recorded_by_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('sickness_records_employee_id_idx').on(table.employeeId),
    index('sickness_records_start_date_idx').on(table.startDate)
  ]
);

export const returnToWorkInterviews = pgTable(
  'return_to_work_interviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sicknessRecordId: uuid('sickness_record_id')
      .notNull()
      .references(() => sicknessRecords.id, { onDelete: 'cascade' }),
    conductedByEmployeeId: uuid('conducted_by_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    conductedOn: date('conducted_on').notNull(),
    notes: text('notes'),
    // Whether adjustments were agreed. The point of the interview is usually this field.
    adjustmentsAgreed: text('adjustments_agreed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique('return_to_work_sickness_record_unique').on(table.sicknessRecordId)]
);

// Absence trigger thresholds — Breathe's "sickness triggers". One row, same singleton pattern
// as leave_settings. The Bradford Factor (S² × D, where S is the number of separate absences
// and D the total days) weights frequent short absences more heavily than one long one, which
// is the pattern it exists to surface.
export const absenceTriggerSettings = pgTable(
  'absence_trigger_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    singleton: boolean('singleton').notNull().default(true),
    // Bradford score at or above which the employee is flagged. 0 disables the check.
    bradfordThreshold: integer('bradford_threshold').notNull().default(125),
    // Rolling window the score is calculated over.
    rollingWindowDays: integer('rolling_window_days').notNull().default(365),
    // Separate occurrence-count trigger, independent of the Bradford score.
    occurrenceThreshold: integer('occurrence_threshold').notNull().default(4),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique('absence_trigger_settings_singleton_unique').on(table.singleton)]
);

// --- HR: documents and acknowledgements ---

export const hrDocumentVisibilityEnum = pgEnum('hr_document_visibility', [
  // Everyone in the company — a handbook, a policy.
  'company',
  // One named employee — a contract, a letter. `employee_id` is set.
  'employee'
]);

// Metadata only; the bytes live in object storage (lib/storage/), same reference-only
// convention as message_attachments and document_links. A handbook and an employment contract
// are the same kind of record with a different audience, so they share a table and differ by
// `visibility` rather than living in two near-identical ones.
export const hrDocuments = pgTable(
  'hr_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    description: text('description'),
    visibility: hrDocumentVisibilityEnum('visibility').notNull(),
    // Set only when visibility is 'employee'. Enforced in the action layer rather than by a
    // check constraint so the error is a sentence rather than a constraint violation.
    employeeId: uuid('employee_id').references(() => employees.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    // Whether the audience has to acknowledge it. A handbook usually does; a payslip does not.
    requiresAcknowledgement: boolean('requires_acknowledgement').notNull().default(false),
    uploadedByEmployeeId: uuid('uploaded_by_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('hr_documents_employee_id_idx').on(table.employeeId),
    index('hr_documents_visibility_idx').on(table.visibility)
  ]
);

/**
 * A record that a named person read and accepted a document.
 *
 * Deliberately NOT a qualified electronic signature. It stores who, when, from where, and a
 * hash of the exact bytes they accepted, which is enough to show internally that a policy was
 * issued and acknowledged. It is not eIDAS/UETA-grade and must not be described as one — if
 * the organisation needs legally binding signing, that is a vendor decision, not something to imply by
 * calling this table "signatures".
 */
export const hrDocumentAcknowledgements = pgTable(
  'hr_document_acknowledgements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => hrDocuments.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    // Typed name, as entered. Compared against the employee's own name by the action, but
    // stored as typed so the record shows what they actually wrote.
    typedName: text('typed_name').notNull(),
    // SHA-256 of the stored file at the moment of acceptance. If the document is later
    // replaced, this proves which version was agreed to.
    documentHash: text('document_hash'),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('hr_document_acknowledgements_document_id_idx').on(table.documentId),
    // "What have I still not acknowledged" is read per employee on every visit to the page.
    index('hr_document_acknowledgements_employee_id_idx').on(table.employeeId),
    unique('hr_document_acknowledgements_document_employee_unique').on(
      table.documentId,
      table.employeeId
    )
  ]
);

// --- HR: performance ---

export const goalStatusEnum = pgEnum('goal_status', [
  'not_started',
  'in_progress',
  'achieved',
  'missed',
  'cancelled'
]);

// Company-level objectives individual ones align to. Visible to everyone: a goal nobody can
// see cannot be aligned to, which is the entire point of publishing them.
export const companyGoals = pgTable('company_goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  status: goalStatusEnum('status').notNull().default('not_started'),
  startDate: date('start_date'),
  dueDate: date('due_date'),
  ownerEmployeeId: uuid('owner_employee_id').references(() => employees.id, {
    onDelete: 'set null'
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const objectives = pgTable(
  'objectives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    // Optional alignment to a company goal. Nullable because a personal development objective
    // legitimately ladders up to nothing.
    companyGoalId: uuid('company_goal_id').references(() => companyGoals.id, {
      onDelete: 'set null'
    }),
    title: text('title').notNull(),
    description: text('description'),
    status: goalStatusEnum('status').notNull().default('not_started'),
    // 0-100. An integer rather than a fraction so the database can average it for reporting.
    progressPercent: integer('progress_percent').notNull().default(0),
    dueDate: date('due_date'),
    createdByEmployeeId: uuid('created_by_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('objectives_employee_id_idx').on(table.employeeId),
    index('objectives_company_goal_id_idx').on(table.companyGoalId)
  ]
);

// Breathe's "deliverables": the concrete actions that come out of an objective or a one-to-one.
export const deliverables = pgTable(
  'deliverables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    objectiveId: uuid('objective_id').references(() => objectives.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    dueDate: date('due_date'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('deliverables_employee_id_idx').on(table.employeeId),
    // Deliverables are read per objective wherever an objective is shown.
    index('deliverables_objective_id_idx').on(table.objectiveId)
  ]
);

export const oneToOnes = pgTable(
  'one_to_ones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    managerEmployeeId: uuid('manager_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    heldOn: date('held_on').notNull(),
    agenda: text('agenda'),
    // Notes both parties can see. The honest default for a one-to-one record.
    sharedNotes: text('shared_notes'),
    /**
     * The manager's own notes. Visible to the manager who wrote them and to HR, never to the
     * employee — a manager who cannot record a private impression will simply keep it out of
     * the system entirely, which is worse for everyone than a field with a clear boundary.
     * That boundary is enforced in lib/permissions/hr-access.ts, not here.
     */
    privateNotes: text('private_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('one_to_ones_employee_id_idx').on(table.employeeId),
    index('one_to_ones_held_on_idx').on(table.heldOn),
    // "The ones I hold" is as common a question here as "the ones about me".
    index('one_to_ones_manager_employee_id_idx').on(table.managerEmployeeId)
  ]
);

export const appraisalStatusEnum = pgEnum('appraisal_status', [
  'draft',
  'awaiting_self_review',
  'awaiting_manager_review',
  'complete'
]);

export const appraisals = pgTable(
  'appraisals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    managerEmployeeId: uuid('manager_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    // Free text ("2026 mid-year") rather than an enum: review cycles differ per business and
    // change, and an enum would need a migration each time.
    cycle: text('cycle').notNull(),
    status: appraisalStatusEnum('status').notNull().default('draft'),
    selfReview: text('self_review'),
    selfReviewSubmittedAt: timestamp('self_review_submitted_at', { withTimezone: true }),
    managerReview: text('manager_review'),
    managerReviewSubmittedAt: timestamp('manager_review_submitted_at', { withTimezone: true }),
    // 1-5, nullable until the manager rates. Integer so it can be averaged for reporting.
    rating: integer('rating'),
    dueDate: date('due_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('appraisals_employee_id_idx').on(table.employeeId),
    unique('appraisals_employee_cycle_unique').on(table.employeeId, table.cycle)
  ]
);

// --- HR: engagement ---

// Recognition wall. Deliberately company-visible and not team-scoped: recognition that only
// the recipient's own team can see does not do the job recognition exists to do.
export const kudos = pgTable(
  'kudos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromEmployeeId: uuid('from_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    toEmployeeId: uuid('to_employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    message: text('message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('kudos_to_employee_id_idx').on(table.toEmployeeId),
    index('kudos_created_at_idx').on(table.createdAt)
  ]
);

export const surveys = pgTable('surveys', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  question: text('question').notNull(),
  /**
   * Anonymous surveys do not store which employee gave which answer — see survey_responses.
   * Fixed at creation and never editable afterwards: flipping a survey to identified after
   * people have answered under a promise of anonymity would break that promise retroactively,
   * and flipping the other way cannot un-collect the identities already stored.
   */
  isAnonymous: boolean('is_anonymous').notNull().default(true),
  opensOn: date('opens_on'),
  closesOn: date('closes_on'),
  createdByEmployeeId: uuid('created_by_employee_id').references(() => employees.id, {
    onDelete: 'set null'
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const surveyResponses = pgTable(
  'survey_responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    surveyId: uuid('survey_id')
      .notNull()
      .references(() => surveys.id, { onDelete: 'cascade' }),
    /**
     * Null for an anonymous survey — the identity is never written, not written and hidden.
     * A column that is populated but filtered out in the query is one careless `select()` away
     * from breaking the anonymity it claims to provide.
     *
     * `respondedEmployeeIds` on the survey is not kept either; preventing a second response to
     * an anonymous survey would require exactly the link this column refuses to store. That
     * trade is deliberate: a repeat answer is a smaller problem than a broken promise.
     */
    employeeId: uuid('employee_id').references(() => employees.id, { onDelete: 'cascade' }),
    // eNPS: 0-10. Kept as an integer score rather than a category so the standard
    // promoter/passive/detractor bands can be derived rather than hard-coded at write time.
    score: integer('score').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('survey_responses_survey_id_idx').on(table.surveyId)]
);

// --- HR: time and attendance ---
//
// Durations here are INTEGER MINUTES, and money is INTEGER PENCE, for the same reason leave
// is integer half days: decimals accumulate rounding error once they are summed across a
// timesheet or a claim, and `numeric` returns strings the caller has to re-parse. Every
// amount in this section is minor units of `currency`, never pounds.

export const payRates = pgTable(
  'pay_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    // What this rate is for — "Standard", "Weekend", "On call". Breathe's multiple pay rates.
    name: text('name').notNull(),
    amountPence: integer('amount_pence').notNull(),
    currency: text('currency').notNull().default('GBP'),
    // The rate in force from this date. A new rate is a new row rather than an edit, so a
    // timesheet approved last month still reconciles against the rate that applied then.
    effectiveFrom: date('effective_from').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('pay_rates_employee_id_idx').on(table.employeeId)]
);

export const shiftTemplates = pgTable('shift_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  // Minutes from midnight. Stored as minutes rather than a time column because a shift that
  // crosses midnight needs an end greater than 1440, which a time column cannot express.
  startMinute: integer('start_minute').notNull(),
  endMinute: integer('end_minute').notNull(),
  unpaidBreakMinutes: integer('unpaid_break_minutes').notNull().default(0),
  colour: text('colour'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const shifts = pgTable(
  'shifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    onDate: date('on_date').notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
    unpaidBreakMinutes: integer('unpaid_break_minutes').notNull().default(0),
    // Copied from the template at creation rather than referenced, so editing a template
    // never silently rewrites rotas that have already been published.
    templateName: text('template_name'),
    notes: text('notes'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdByEmployeeId: uuid('created_by_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('shifts_employee_id_idx').on(table.employeeId),
    index('shifts_on_date_idx').on(table.onDate)
  ]
);

export const shiftSwapStatusEnum = pgEnum('shift_swap_status', [
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'approved'
]);

export const shiftSwapRequests = pgTable(
  'shift_swap_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id, { onDelete: 'cascade' }),
    requestedByEmployeeId: uuid('requested_by_employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    // Who is being asked to take it. Null means it is offered to anyone.
    offeredToEmployeeId: uuid('offered_to_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    // Two-step by design: the colleague accepts, then a manager approves. A swap that only
    // needs the other person's agreement lets two employees rewrite the rota between them.
    status: shiftSwapStatusEnum('status').notNull().default('pending'),
    acceptedByEmployeeId: uuid('accepted_by_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    approvedByEmployeeId: uuid('approved_by_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('shift_swap_requests_shift_id_idx').on(table.shiftId)]
);

export const timesheetStatusEnum = pgEnum('timesheet_status', [
  'open',
  'submitted',
  'approved',
  'rejected'
]);

// A week of recorded hours, submitted as one unit. Weekly rather than per-entry approval
// because approving forty individual rows is how timesheet approval stops happening.
export const timesheets = pgTable(
  'timesheets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    // Monday of the week this sheet covers. Identifies the period without a separate table.
    weekStart: date('week_start').notNull(),
    status: timesheetStatusEnum('status').notNull().default('open'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedByEmployeeId: uuid('decided_by_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('timesheets_employee_id_idx').on(table.employeeId),
    unique('timesheets_employee_week_unique').on(table.employeeId, table.weekStart)
  ]
);

export const timesheetEntries = pgTable(
  'timesheet_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    timesheetId: uuid('timesheet_id')
      .notNull()
      .references(() => timesheets.id, { onDelete: 'cascade' }),
    onDate: date('on_date').notNull(),
    minutes: integer('minutes').notNull(),
    // Optional link to a project, so hours can be reported against a budget. Joins the
    // existing projects table rather than inventing a second project entity.
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    isBillable: boolean('is_billable').notNull().default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('timesheet_entries_timesheet_id_idx').on(table.timesheetId),
    index('timesheet_entries_project_id_idx').on(table.projectId)
  ]
);

export const clockEventTypeEnum = pgEnum('clock_event_type', [
  'in',
  'out',
  'break_start',
  'break_end'
]);

/**
 * Clock in/out events, append-only.
 *
 * Stored as individual events rather than as a session row with a start and end, so that a
 * missing clock-out is visible as missing data rather than as an open row nobody can
 * distinguish from someone still working. Pairing happens on read.
 *
 * Deliberately carries NO location columns. Breathe offers geo-tracking and geo-fencing of
 * staff; continuous employee location monitoring needs a DPIA, a lawful basis and staff
 * consultation before it can lawfully be switched on in the UK, so it is a separate decision
 * rather than something to ship because a competitor lists it. Adding latitude/longitude here
 * later is a schema change, and that is the point — it should not be possible to enable it by
 * flipping a setting.
 */
export const clockEvents = pgTable(
  'clock_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    eventType: clockEventTypeEnum('event_type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    // Set when a manager corrects a mis-clock, so an edited record is never mistaken for a
    // machine-recorded one.
    correctedByEmployeeId: uuid('corrected_by_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    note: text('note')
  },
  (table) => [index('clock_events_employee_occurred_idx').on(table.employeeId, table.occurredAt)]
);

// --- HR: expenses ---

export const expenseClaimStatusEnum = pgEnum('expense_claim_status', [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'paid'
]);

export const expenseCategories = pgTable(
  'expense_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    // Per-item ceiling. Null means no limit. Breathe's "spending limits".
    warnOverPence: integer('warn_over_pence'),
    blockOverPence: integer('block_over_pence'),
    isMileage: boolean('is_mileage').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique('expense_categories_name_unique').on(table.name)]
);

/**
 * HMRC approved mileage rates, in pence per mile, banded by distance already claimed in the
 * tax year. In the database rather than in code because the rates change and a rate change
 * must not require a deploy — and because the correct rate depends on the date of the
 * journey, so past claims have to keep reconciling against the rate that applied then.
 */
export const mileageRates = pgTable(
  'mileage_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleType: text('vehicle_type').notNull().default('car'),
    // Inclusive lower bound of the band, in miles claimed so far this tax year.
    fromMiles: integer('from_miles').notNull().default(0),
    pencePerMile: integer('pence_per_mile').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique('mileage_rates_band_unique').on(table.vehicleType, table.fromMiles, table.effectiveFrom)
  ]
);

export const expenseClaims = pgTable(
  'expense_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    status: expenseClaimStatusEnum('status').notNull().default('draft'),
    currency: text('currency').notNull().default('GBP'),
    // Denormalised sum of the claim's items, maintained by the action layer. Kept on the row
    // because every list screen shows a claim total, and recomputing it per row turns one
    // query into one-per-claim.
    totalPence: integer('total_pence').notNull().default(0),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedByEmployeeId: uuid('decided_by_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('expense_claims_employee_id_idx').on(table.employeeId),
    index('expense_claims_status_idx').on(table.status)
  ]
);

export const expenseItems = pgTable(
  'expense_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => expenseClaims.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => expenseCategories.id, {
      onDelete: 'restrict'
    }),
    description: text('description').notNull(),
    spentOn: date('spent_on').notNull(),
    amountPence: integer('amount_pence').notNull(),
    // Mileage items: the distance and the rate used, kept so a claim can be re-checked
    // without guessing which rate band applied.
    miles: integer('miles'),
    pencePerMileUsed: integer('pence_per_mile_used'),
    // Receipt, reference-only like every other file in this app.
    receiptStorageKey: text('receipt_storage_key'),
    receiptFileName: text('receipt_file_name'),
    // Optional link so spend can be reported against a client or project.
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('expense_items_claim_id_idx').on(table.claimId)]
);

// --- HR: learning and development ---
//
// The platform, not the content. Breathe bundles a library of ~100 bite-size courses; that
// content is licensed to them and cannot be copied, so the organisation supplies or licenses its own. The
// library ships empty with an honest empty state rather than with invented filler
// (engineering rule 7).

export const courses = pgTable('courses', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  provider: text('provider'),
  // Where the material actually lives. External by default — the organisation is not building a video
  // platform, and a link to a real provider is more honest than a player with nothing in it.
  externalUrl: text('external_url'),
  estimatedMinutes: integer('estimated_minutes'),
  // Courses can be required of a whole department or role rather than assigned one by one.
  requiredForTeam: text('required_for_team'),
  requiredForRole: employeeRoleEnum('required_for_role'),
  // How long a completion stays valid. Fire safety lapses; a spreadsheet course does not.
  validForMonths: integer('valid_for_months'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

// An ordered set of courses — Breathe's "playlists".
export const coursePlaylists = pgTable('course_playlists', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const coursePlaylistItems = pgTable(
  'course_playlist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playlistId: uuid('playlist_id')
      .notNull()
      .references(() => coursePlaylists.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0)
  },
  (table) => [unique('course_playlist_items_unique').on(table.playlistId, table.courseId)]
);

export const enrolmentStatusEnum = pgEnum('enrolment_status', [
  'assigned',
  'in_progress',
  'completed',
  'expired'
]);

export const courseEnrolments = pgTable(
  'course_enrolments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    status: enrolmentStatusEnum('status').notNull().default('assigned'),
    progressPercent: integer('progress_percent').notNull().default(0),
    dueOn: date('due_on'),
    completedOn: date('completed_on'),
    // Derived from the course's validForMonths at completion and then stored, so changing the
    // course later does not retroactively expire or revive someone's certificate.
    expiresOn: date('expires_on'),
    assignedByEmployeeId: uuid('assigned_by_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('course_enrolments_employee_id_idx').on(table.employeeId),
    index('course_enrolments_expires_on_idx').on(table.expiresOn),
    unique('course_enrolments_course_employee_unique').on(table.courseId, table.employeeId)
  ]
);

// --- HR: health and safety ---

export const riskLevelEnum = pgEnum('risk_level', ['low', 'medium', 'high']);

export const riskAssessments = pgTable(
  'risk_assessments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    location: text('location'),
    hazard: text('hazard').notNull(),
    whoIsAtRisk: text('who_is_at_risk'),
    existingControls: text('existing_controls'),
    furtherActionNeeded: text('further_action_needed'),
    // Likelihood and severity, each 1-5. The product is the risk score, derived rather than
    // stored so the two inputs stay editable and the score cannot disagree with them.
    likelihood: integer('likelihood').notNull(),
    severity: integer('severity').notNull(),
    level: riskLevelEnum('level').notNull().default('low'),
    assessedByEmployeeId: uuid('assessed_by_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    assessedOn: date('assessed_on').notNull(),
    // Indexed: the overdue-review sweep reads it, same reason as training expiry.
    reviewDueOn: date('review_due_on'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('risk_assessments_review_due_on_idx').on(table.reviewDueOn)]
);

export const incidentKindEnum = pgEnum('incident_kind', [
  'accident',
  'near_miss',
  'hazard',
  'dangerous_occurrence',
  'ill_health'
]);

/**
 * Accident and incident log, plus employee-reported hazards and near misses — one table,
 * distinguished by `kind`. They share every field that matters and splitting them would make
 * "everything reported this month" a union query.
 *
 * `riddorReportable` is a flag a human sets, never inferred. Whether an incident is reportable
 * under RIDDOR is a legal judgement with a deadline attached, and software guessing it would
 * be worse than software asking.
 */
export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: incidentKindEnum('kind').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    location: text('location'),
    description: text('description').notNull(),
    // Who was hurt or involved. Nullable: a near miss or a hazard often involves nobody.
    affectedEmployeeId: uuid('affected_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    // Injury detail is health data — HIGHLY CONFIDENTIAL, HR and safety roles only.
    injuryDetail: text('injury_detail'),
    immediateAction: text('immediate_action'),
    reportedByEmployeeId: uuid('reported_by_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    riddorReportable: boolean('riddor_reportable').notNull().default(false),
    riddorReportedOn: date('riddor_reported_on'),
    investigationNotes: text('investigation_notes'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('incidents_occurred_at_idx').on(table.occurredAt),
    index('incidents_kind_idx').on(table.kind),
    // Read by the predicate deciding who may see injury detail, which runs per incident.
    index('incidents_affected_employee_id_idx').on(table.affectedEmployeeId)
  ]
);

// Fire marshal, first aider, mental health first aider — with the expiry that makes the
// record worth keeping. Indexed on expiry for the same reminder sweep as training records.
export const safetyRoles = pgTable(
  'safety_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    roleName: text('role_name').notNull(),
    certifiedOn: date('certified_on'),
    expiresOn: date('expires_on'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('safety_roles_employee_id_idx').on(table.employeeId),
    index('safety_roles_expires_on_idx').on(table.expiresOn)
  ]
);

// --- HR: recruitment ---

export const vacancyStatusEnum = pgEnum('vacancy_status', ['draft', 'open', 'closed', 'filled']);

export const vacancies = pgTable('vacancies', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  team: text('team'),
  description: text('description'),
  location: text('location'),
  // Salary range, in pence, and nullable — many adverts do not publish one.
  salaryMinPence: integer('salary_min_pence'),
  salaryMaxPence: integer('salary_max_pence'),
  status: vacancyStatusEnum('status').notNull().default('draft'),
  hiringManagerEmployeeId: uuid('hiring_manager_employee_id').references(() => employees.id, {
    onDelete: 'set null'
  }),
  closesOn: date('closes_on'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const applicationStageEnum = pgEnum('application_stage', [
  'applied',
  'shortlisted',
  'interviewing',
  'offered',
  'hired',
  'rejected',
  'withdrawn'
]);

/**
 * A candidate's application.
 *
 * Candidates are *not* employees and are deliberately not rows in the `employees` table: they
 * have no account, no role and no permissions, and mixing them in would put non-staff inside
 * every query that assumes an employees row is a colleague. A hired candidate is converted
 * into a pending employee by the action layer, which is an explicit step rather than a
 * consequence of changing a status field.
 *
 * This table holds personal data about people outside the company, so it carries its own
 * retention question — see docs/data-classification.md.
 */
export const jobApplications = pgTable(
  'job_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vacancyId: uuid('vacancy_id')
      .notNull()
      .references(() => vacancies.id, { onDelete: 'cascade' }),
    candidateName: text('candidate_name').notNull(),
    candidateEmail: text('candidate_email').notNull(),
    candidatePhone: text('candidate_phone'),
    stage: applicationStageEnum('stage').notNull().default('applied'),
    coverNote: text('cover_note'),
    cvStorageKey: text('cv_storage_key'),
    cvFileName: text('cv_file_name'),
    rating: integer('rating'),
    notes: text('notes'),
    // Set once the candidate becomes an employee, so the hand-off cannot happen twice.
    convertedEmployeeId: uuid('converted_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    appliedOn: date('applied_on').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('job_applications_vacancy_id_idx').on(table.vacancyId),
    index('job_applications_stage_idx').on(table.stage),
    unique('job_applications_vacancy_email_unique').on(table.vacancyId, table.candidateEmail)
  ]
);

export const interviews = pgTable(
  'interviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => jobApplications.id, { onDelete: 'cascade' }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    interviewerEmployeeId: uuid('interviewer_employee_id').references(() => employees.id, {
      onDelete: 'set null'
    }),
    location: text('location'),
    feedback: text('feedback'),
    recommendation: text('recommendation'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('interviews_application_id_idx').on(table.applicationId)]
);
