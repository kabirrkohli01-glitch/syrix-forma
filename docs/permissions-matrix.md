# SYRIX Forma — Permissions Matrix (draft)

Status: Phase 2 draft. Every check here must be enforced server-side (engineering rule 10)
— this document describes intended behavior, it is not itself the control.

Roles: `EMPLOYEE | TEAM_LEAD | MANAGER | ADMIN | SECURITY_ADMIN` (see engineering rule 10).

| Resource | Action | EMPLOYEE | TEAM_LEAD | MANAGER | ADMIN | SECURITY_ADMIN |
|---|---|---|---|---|---|---|
| Own tasks (assigned to me) | view/edit | ✅ | ✅ | ✅ | ✅ | ❌ |
| Team's tasks | view | ❌ | ✅ (own team) | ✅ (cross-team) | ✅ | ❌ |
| Team's tasks | assign | ❌ | ✅ (own team) | ✅ (cross-team) | ✅ | ❌ |
| Client data | view | ✅ (staffed only) | ✅ (team's clients) | ✅ (cross-team) | ✅ | ❌ |
| Client data | edit | ✅ (staffed only) | ✅ (team's clients) | ✅ (cross-team) | ✅ | ❌ |
| Client staff assignment | manage | ❌ | ✅ (own team) | ✅ (cross-team) | ✅ | ❌ |
| Project data | view/edit | ✅ (staffed only) | ✅ (team's projects) | ✅ (cross-team) | ✅ | ❌ |
| Project staff assignment | manage | ❌ | ✅ (own team) | ✅ (cross-team) | ✅ | ❌ |
| Enquiries | view/create | ✅ (own team) | ✅ (team's) | ✅ (cross-team) | ✅ | ❌ |
| Calendar events | view/edit | ✅ (created/invited only) | ✅ (team's + invited elsewhere) | ✅ (cross-team) | ✅ | ❌ |
| Reports (basic) | view | ❌ | ❌ | ✅ | ✅ | ❌ |
| User/role management | manage | ❌ | ❌ | ❌ | ✅ | ❌ |
| Integrations config | manage | ❌ | ❌ | ❌ | ✅ | ❌ |
| Hostinger mailbox search / connection | use | ❌ | ❌ | ❌ | ✅ | ❌ |
| Enquiry email reply (send) | use | ✅ (own team) | ✅ (team's) | ✅ (cross-team) | ✅ | ❌ |
| Document links (client/project) | view/add/remove | same as the linked Client/Project's own view/edit access — no separate tier | | | | ❌ |
| Automations (definitions + run history) | view | ❌ | ❌ | ❌ | ✅ | ❌ |
| Automations (enable/disable, config) | manage | ❌ | ❌ | ❌ | ✅ | ❌ |
| Automation kill-switch | use | ❌ | ❌ | ❌ | ✅ | ❌ |
| Sessions / audit log | view | ❌ | ❌ | ❌ | ❌ | ✅ |
| Security events / Security Centre | view | ❌ | ❌ | ❌ | ❌ | ✅ |
| General business data (clients/projects/tasks) | view | ❌ | ❌ | ❌ | ❌ | ❌ |
| Team Chat conversation | view/send/read | participant only — same rule for every role | | | | participant only |
| Team Chat conversation | create (DM/group) | ✅ (any active employee) | ✅ | ✅ | ✅ | ✅ |
| Team Status (own work status: working/break/logged off) | set | ✅ (self only) | ✅ (self only) | ✅ (self only) | ✅ (self only) | ✅ (self only) |
| Team Status board (everyone's live status) | view | ✅ (company-wide) | ✅ (company-wide) | ✅ (company-wide) | ✅ (company-wide) | ❌ (page-level gate) |

Implementation, Phase 2 (`apps/web/lib/permissions/`):
- `task-access.ts` — `canViewTask`/`canEditTask`/`canAssignTask`. A task's "own" scope is
  `assigneeId` matching the caller, not the task's `id`. Team scope compares the caller's team
  against the task's own `team` column (`tasks.team` — independent of `assigneeId`, so an
  unassigned task is still visible/assignable to its own team's TEAM_LEAD).
- `client-access.ts` / `project-access.ts` — `canView*`/`canEdit*`/`canManage*Staff`. "Own"
  scope (EMPLOYEE) is staff-membership in `client_staff`/`project_staff`, looked up by the
  caller and passed in as a boolean — not derivable inside a pure predicate. Team scope
  compares the caller's team against the resource's own `team` column (`clients.team`/
  `projects.team` — independent of who's staffed on it, for the same reason as Task above).
  Staff assignment management (`canManageClientStaff`/`canManageProjectStaff`) is TEAM_LEAD+
  only — a staffed EMPLOYEE can view/edit but not add or remove other staff.

Notes:
- SECURITY_ADMIN is deliberately scoped away from general business data — it is a security
  role, not a super-admin role.
- ADMIN does not automatically get SECURITY_ADMIN's audit/session visibility — kept separate
  so a single compromised/malicious ADMIN account cannot also erase its own trail.
- This table will grow real rows as later phases implement the permission-check layer in
  `apps/web/lib/permissions/` — treat gaps here as things to fill in before the corresponding
  feature ships, not after.

Implementation, Phase 3 (`apps/web/lib/permissions/`):
- `enquiry-access.ts` — mirrors `task-access.ts` exactly: `canViewEnquiry`/`canEditEnquiry` via
  `scopeForBusinessData`, comparing the caller's team against the enquiry's own `team` column.
  No separate "own" concept beyond team scope — an enquiry has no assignee field to be "own" via.
- `automation-access.ts` — `canViewAutomations`/`canManageAutomations`, both ADMIN-only, same
  scope as the existing `canUseAutomationKillSwitch` in `roles.ts`. Automations are
  platform-level configuration, not team-scoped business data, so there is no team/cross-team
  tier here the way there is for Task/Client/Project/Enquiry.

Implementation, Phase 4 (`apps/web/lib/permissions/`, `apps/web/features/`):
- `integration-access.ts` — `canViewIntegrations`/`canManageIntegrations`, both ADMIN-only, same
  shape as `automation-access.ts`. Connecting/disconnecting Hostinger Mail, assigning its owner,
  and searching the live mailbox on the Email page are all gated by this — a raw company
  mailbox is treated as more sensitive than team-scoped business data, not less.
- Enquiry email replies (`features/enquiries/actions.ts`'s `sendEnquiryReply`) reuse
  `canEditEnquiry` unchanged — replying is an edit of that specific enquiry's thread, not a
  mailbox-wide capability, so it stays team-scoped like every other enquiry action.
- Document links have no dedicated predicate file — `features/document-links/actions.ts` reuses
  `canEditClient`/`canEditProject` directly against the link's parent, since a document link's
  correct permission tier is always exactly its parent's edit access. Viewing a client/project
  page already gates on `canViewClient`/`canViewProject` before any of its cards (including
  Documents) render, so no separate view-check exists for the links themselves.

Implementation, Phase 5 ("My Work, expanded" — `apps/web/features/tasks/`):
- Subtasks, checklist items, comments, watchers, dependencies, and task-scoped document links
  (attachments) all reuse `canViewTask`/`canEditTask` unchanged — no new predicate file, no new
  scope tier. A subtask is created via `createTask` with `parentTaskId` set, so it goes through
  the exact same checks as any other task create.
- View-tier actions (comment on a task, watch a task yourself): gated on `canViewTask`.
  Edit-tier actions (checklist items, dependencies, watching *someone else*, subtask creation):
  gated on `canEditTask`. Editing/removing your own comment is gated on authorship
  (`taskComments.authorEmployeeId === caller.id`), not a role check — anyone who could comment can
  edit their own comment regardless of role.
- Adding a task dependency additionally requires `canViewTask` on the task being depended on
  (you can't link to a task you can't see), on top of `canEditTask` on the task gaining the
  dependency.

Implementation, Phase 5 (native Calendar — `apps/web/lib/permissions/calendar-access.ts`):
- `canViewCalendarEvent`/`canEditCalendarEvent` are identical (same pattern task-access.ts's
  comment notes for Task — may split later for approvals, not yet). "Own" scope (EMPLOYEE) is
  creator-or-attendee (`callerIsInvolved`, looked up by the caller before invoking, same
  convention as Client/Project's `callerIsStaffed`), not a single assignee.
- Deliberate deviation from the Client/Project team-scope pattern: a TEAM_LEAD/MANAGER whose
  `team` doesn't match the event's `team` can still view/edit it if they were personally invited
  as an attendee, even cross-team — an event can legitimately involve people outside the team it's
  tagged under (e.g. a cross-team sync), unlike a Client/Project record.
- SECURITY_ADMIN has no calendar access (`scopeForBusinessData` returns `'none'`), same as every
  other general business resource.

Implementation, Phase 5 (Client Centre expansion — `apps/web/features/clients/`):
- Client notes reuse `canViewClient` for add/read (same "can you see this client" bar as document
  links/tasks), and authorship (`clientNotes.authorEmployeeId === caller.id`) for edit/delete of
  your own note, not a role check — same shape as task comments.
- Linked meetings and linked email activity carry no new permission code — meetings are filtered
  per-row through the existing `canViewCalendarEvent`, and email activity's own visibility is
  already covered by the page-level `canViewClient` gate (same as every other card on that page).

Implementation, Phase 5 (Approvals / step-up auth — `apps/web/lib/permissions/step-up.ts`):
- `requireStepUpAuth(employeeId)` is an *additional* gate layered on top of each action's normal
  role/scope check (e.g. `canManageAutomations`, `requireRole('ADMIN')`), never a replacement for
  it — a caller must already be permitted to take the action at all before step-up is even
  checked.
- Gated today: the automation kill-switch, per-automation enable/disable/owner/config changes,
  approving/editing/disabling an employee (granting permissions, admin changes), and enquiry
  email replies (outbound comms). Not gated: no data-export feature exists yet to gate — added
  when one does.
- Enforced only server-side, same as every other predicate in this directory —
  `useStepUpGuardedAction` (`apps/web/features/step-up/`) is UI convenience (it opens a re-auth
  dialog and retries once verified), not the actual control.
- Skipped when `NODE_ENV === 'development'` (added 2026-09-07) — same dev-convenience pattern as
  the initial MFA setup/challenge skip in `app/dashboard/layout.tsx`. Requiring a fresh TOTP code
  for every kill-switch toggle/admin change/enquiry reply while iterating locally was pure
  friction with no real security benefit in that environment; the check still runs unconditionally
  anywhere `NODE_ENV` isn't literally `development`, including any real deployment.

Implementation, Phase 5 (project templates — `apps/web/features/project-templates/`):
- Every template action (create/delete template, add/remove template task/milestone,
  `createProjectFromTemplate`) is `requireRole('TEAM_LEAD', 'MANAGER', 'ADMIN')` — the identical
  literal gate `createProject` already uses, since a template is just a pre-filled shortcut to
  the same action. The Settings page itself 404s (not 403s) a plain EMPLOYEE, same pattern as
  Access Control/Integrations.

Implementation, Phase 5 (Teams, Global Search, Unified Action Centre): no new predicates —
- Teams (`/dashboard/teams`) reuses `scopeForBusinessData`: EMPLOYEE/TEAM_LEAD see only their own
  team's card, MANAGER/ADMIN see every team, SECURITY_ADMIN sees none.
- Global Search (`/dashboard/search`) reuses `clientScopeCondition`/`projectScopeCondition`/
  `taskScopeCondition` directly, including joined against Documents/Emails' parent — see the
  Client Centre section above's Documents/Emails note, same idiom.
- The Unified Action Centre (`app/dashboard/page.tsx`) gates each section behind whichever
  existing predicate already governs that data (`scopeForBusinessData` for
  enquiries/clients/milestones/calendar, `canViewAutomations`/`canViewIntegrations` for the two
  ADMIN-only sections) — no section invented a new visibility rule.

Implementation, Phase 6 (Reports & Management Dashboards — `apps/web/app/dashboard/reports/`,
`apps/web/features/reports/`): no new predicate file —
- The whole page is gated on the existing `canViewBasicReports` (`lib/permissions/roles.ts`,
  MANAGER/ADMIN only — unchanged from this table's own "Reports (basic)" row above). Unlike every
  other business-data view, that's also the *only* scoping Reports needs: `scopeForBusinessData`
  already resolves MANAGER to `'cross-team'` and ADMIN to `'all'`, and both of those already mean
  "see every team's data" everywhere else in the app (`canViewClient`/`canViewTask`'s own `MANAGER
  → true` branches) — so every report query in `features/reports/utils/queries.ts` runs
  unfiltered rather than re-deriving a scope condition that would always resolve to "no filter"
  for the only two roles that can reach this page.
- The one exception is the Automation performance section, gated a level stricter behind the
  existing `canViewAutomations` (ADMIN-only) — same tier as the Automations page itself and the
  Action Centre's admin-only sections, and hidden from a MANAGER even though they can see the rest
  of Reports.

Implementation, Team Chat (added post-Phase-6 — `apps/web/lib/permissions/chat-access.ts`):
- Deliberately the only resource in this app with no role/team scope tier at all — every role
  can create a conversation, and every role's access to an existing one is exactly
  `isConversationParticipant(caller, conversationId)`, re-checked server-side on every read and
  write action, never trusting a client-supplied conversation id. There is no "team's
  conversations" or "cross-team" visibility the way there is for Task/Client/Project — being
  added as a participant is the only way in.
- SECURITY_ADMIN gets the same participant-only rule as every other role here — Chat is not
  general business data (where SECURITY_ADMIN is walled off entirely) nor a security surface
  SECURITY_ADMIN oversees; if added to a conversation, they can use it like anyone else.
- This is the authorization test for the feature: a non-participant calling `sendMessage`/
  `getMessages`/`markConversationRead` directly for a conversation they were never added to must
  be rejected, regardless of role — including ADMIN, since platform administration doesn't imply
  standing access to other people's private conversations.
- **Error message sanitization** (added 2026-09-07, `features/chat/utils/errors.ts`): every
  chat action's catch block funnels through `throwSanitizedChatError`. A deliberately-thrown
  `ExpectedChatError` (permission denial, not-found, validation) is always safe to show verbatim.
  Anything else — a DB failure, a storage-provider error — is logged server-side and never shown
  to the caller unless they're ADMIN/SECURITY_ADMIN; every other role gets a generic "contact
  your admin" message instead. This is currently scoped to Team Chat only — the same
  raw-error-in-toast pattern predates this feature elsewhere in the app (tasks, clients,
  automations) and has not been swept yet.

Implementation, Team Status (added post-Phase-6 — `apps/web/features/teams/actions.ts`):
- `setWorkStatus` has no permission predicate file of its own — its only check is
  `requireActiveEmployee()`, and it always writes to the caller's own `employees` row (the input
  carries no target employee id), so there is nothing for a role/scope check to gate. Every
  active employee, any role, can set their own status.
- The Teams page's status board reads every active employee's `workStatus` unfiltered by
  `scopeForBusinessData` — deliberately different from the team-stat cards below it on the same
  page, which stay scoped as before. It is still reached only if the page's existing
  `scope === 'none'` gate passes, so SECURITY_ADMIN — walled off from the Teams page already —
  gets no exception for this section either.

## HR (`apps/web/lib/permissions/hr-access.ts`)

Adds one role, `HR_ADMIN`, and two per-employee flags, `financeAccess` and `hrAdmin`. The role set
is `EMPLOYEE | TEAM_LEAD | MANAGER | ADMIN | SECURITY_ADMIN | HR_ADMIN`.

**"HR_ADMIN" in every row below means `isHrAdmin(caller)`, not the role alone.** An employee holds
exactly one role, and `canManageUsers` is ADMIN-only, so gating HR on the role by itself made HR
administration mutually exclusive with platform administration — an ADMIN who switched their own
role to HR_ADMIN in order to configure leave lost the screen that grants roles and had no way
back. For a company small enough that one person is both, the single-role model has no correct
answer. `employees.hr_admin` is that answer: a capability granted on top of whatever role someone
already holds, exactly as `financeAccess` already was, and for the same stated reason.

Two properties of the capability that must not drift:

- It grants HR administration and nothing else. Business-data scope still comes from the role
  (`lib/permissions/roles.ts`); holding it widens nothing outside `hr-access.ts`.
- `isHrAdmin` returns false for SECURITY_ADMIN whatever the flag says, so it can never become a
  route around the wall that keeps that role out of business and HR data.

It is granted in Settings → People & Access, is step-up authenticated like a role change, is
written to the audit log, and is cleared automatically when an account is disabled — so a
re-enabled account never comes back holding access nobody granted it a second time. Queries that
ask the same question of a *row* rather than of the caller (who should approve this leave, who to
notify about an incident) use `isHrAdminRow` in `lib/db/hr-admin.ts`; a query still comparing only
the role would silently route approvals to nobody.

HR is kept in its own table below rather than being added as columns to the matrix at the top of
this document, because **HR does not use the team scope every row up there uses**.
`scopeForBusinessData` appears nowhere in `hr-access.ts`. Applying it would mean a TEAM_LEAD
could read a same-team colleague's date of birth and salary purely by sharing a team, which is
not a defensible rule for special category personal data. HR scopes on the line management chain
(`employees.manager_id`) and on `HR_ADMIN`/`financeAccess` instead.

"Other roles" below means EMPLOYEE / TEAM_LEAD / MANAGER / ADMIN looking at someone who is
neither themselves nor their direct report. The bands are separate predicates precisely so that
a line manager can hold the middle one without the top one.

| Band | Fields | Self | Line manager | Finance user | HR_ADMIN | Other roles | SECURITY_ADMIN |
|---|---|---|---|---|---|---|---|
| Employment | job title, contract type, start/probation/leaving date, working pattern, training records | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Identity | date of birth, National Insurance number, home address, emergency contact | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Pay | salary, hourly rate, bank details | ✅ view only | ❌ | ✅ | ✅ | ❌ | ❌ |
| Edit HR record | — | contact details only | ❌ | ❌ | ✅ | ❌ | ❌ |
| Edit pay | — | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| HR settings (custom fields, policy) | — | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| HR reports (aggregate) | — | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Payroll export | — | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |

Notes, each a deliberate decision rather than an omission:

- **The ADMIN role gets no HR access at all.** Platform administration — user/role management,
  integrations, the automation kill-switch — does not imply standing access to everyone's
  medical and pay records, for the same reason ADMIN does not get SECURITY_ADMIN's audit log.
  An ADMIN who needs HR is granted the `hrAdmin` capability explicitly, and that grant is itself
  audited; what is ruled out is HR access arriving as a side effect of being an administrator.
  An ADMIN who needs HR access is granted `HR_ADMIN` explicitly, and that grant is audited.
- **SECURITY_ADMIN gets no HR access, including their own record.** HR data is more sensitive
  than the general business data they are already walled off from, not less.
- **HR_ADMIN gets no elevated business-data access.** `scopeForBusinessData` resolves it to
  `'own'`, identical to a plain EMPLOYEE — the role is deep, not wide.
- **`financeAccess` is a flag, not a role**, so it composes with whatever role the holder
  already has (a bookkeeper who is otherwise an EMPLOYEE, or a MANAGER who signs off spend).
  Modelling it as a role would force a choice between the two.
- **Listing breadth and record depth are separate questions.** `canListAllEmployees` is
  deliberately not `hrScopeFor(caller) === 'all'`: a finance user must be able to find everyone
  by name to reach the pay they are entitled to, but widening `hrScopeFor` for them would
  wrongly hand them the identity band too, since the band predicates key off that scope.
- **A band the caller is not entitled to is never read out of the database**, rather than being
  fetched and hidden in the markup — hiding a field client-side still ships it to the browser,
  which Section 10 does not count as a control.
- **`getEmployeeHrRecord` returns null for both "no such employee" and "not yours to see"**, and
  the page renders the same 404 for both. A distinct 403 would confirm to an unauthorised caller
  that a given employee id exists.
- Write access is narrower than read access throughout: an employee can read their own salary
  but not set it, and a finance user can read salaries across the company without changing one.
- Authorization tests: `tests/authorization/cross-employee-hr-access.test.ts` (real query layer
  against the real database) and `tests/permissions/hr-access.unit.test.ts` (pure predicates).

### HR: time off and absence

Leave and absence *dates* follow the employment band — a line manager needs to know when their
report is away in order to plan the work. Absence *medical detail* does not.

| Action | Self | Line manager | HR_ADMIN | Other roles | SECURITY_ADMIN |
|---|---|---|---|---|---|
| View leave request | ✅ | ✅ | ✅ | ❌ | ❌ |
| Book leave for someone | ✅ (own) | ❌ | ✅ | ❌ | ❌ |
| Decide (approve/decline) | ❌ | ✅ | ✅ | ❌ | ❌ |
| Cancel | ✅ (own) | ❌ (declines instead) | ✅ | ❌ | ❌ |
| View absence dates and duration | ✅ | ✅ | ✅ | ❌ | ❌ |
| View absence category, notes, fit note | ✅ | ❌ | ✅ | ❌ | ❌ |
| Record an absence | ✅ (own) | ✅ | ✅ | ❌ | ❌ |
| Record a return-to-work interview | ❌ | ✅ | ✅ | ❌ | ❌ |
| View absence trigger flags | ❌ | ✅ (own reports) | ✅ | ❌ | ❌ |

- **Nobody approves their own leave.** `canDecideLeaveRequest` excludes self before any other
  branch. Without it, a MANAGER whose own `manager_id` is null — the normal state for the most
  senior person in a chain — would fall through to a broader rule and approve their own
  holiday. HR is the backstop when nobody is named as line manager, and `listPendingApprovals`
  excludes HR's own requests from HR's own queue for the same reason.
- **Cancel and decline are different acts** and are kept apart deliberately: declining is a
  decision on a request that was made, cancelling is the requester withdrawing it. Collapsing
  them would lose that distinction in the record.
- **A return-to-work interview cannot be recorded by the person returning.** An interview
  somebody holds with themselves is not one.
- **Medical detail is redacted in the query, per row, not in the component.** Entitlement to it
  is per-subject rather than per-caller: a line manager sees their own reason (they are the
  subject) and not their report's, so one boolean computed once for the whole list would get it
  wrong. Redacting server-side also means it is never sent to the browser.
- **The audit log records leave and absence dates, never reasons or medical detail.** The audit
  log is readable by SECURITY_ADMIN, who `docs/data-classification.md` walls off from special
  category data — writing a sickness category into it would route health data straight to the
  one role that must not have it.
- **Bradford Factor scores are reported, never acted on.** The score surfaces a pattern worth a
  conversation; an automated sanction driven by an absence pattern is exactly the "automation
  decides" behaviour engineering rule 1 rules out. Only closed absences count, since an
  absence still running has no final length.
- Tests: `tests/hr/leave-flow.test.ts` (booking, balance, approval routing, calendar write and
  cleanup, on-behalf-of rules), `tests/hr/absence-flow.test.ts` (medical redaction per role),
  `tests/hr/leave-calculation.unit.test.ts` (the arithmetic, including the timezone and
  double-deduction traps).

### HR: documents, performance and engagement

| Action | Self | Line manager | HR_ADMIN | Everyone | SECURITY_ADMIN |
|---|---|---|---|---|---|
| Read a company document | — | — | ✅ | ✅ | ❌ |
| Read a personal document | ✅ | ❌ | ✅ | ❌ | ❌ |
| Upload / archive a document | ❌ | ❌ | ✅ | ❌ | ❌ |
| Acknowledge a document | ✅ (own audience) | ❌ | ✅ (own) | ✅ (company docs) | ❌ |
| View company goals | — | — | ✅ | ✅ | ❌ |
| Set company goals | ❌ | ❌ | ✅ | ❌ | ❌ |
| View objectives / deliverables | ✅ | ✅ | ✅ | ❌ | ❌ |
| Set objectives / deliverables | ✅ (own) | ✅ (reports) | ✅ | ❌ | ❌ |
| View one-to-one shared notes | ✅ | ✅ | ✅ | ❌ | ❌ |
| View one-to-one **private** notes | ❌ | ✅ (ones they held) | ✅ | ❌ | ❌ |
| Record a one-to-one | ❌ | ✅ | ✅ | ❌ | ❌ |
| Write the self-review | ✅ | ❌ | ❌ | ❌ | ❌ |
| Write the manager review and rating | ❌ | ✅ | ✅ | ❌ | ❌ |
| Give recognition | — | — | ✅ | ✅ | ❌ |
| Respond to a survey | — | — | ✅ | ✅ | ❌ |
| Create a survey / see results | ❌ | ❌ | ✅ | ❌ | ❌ |

- **A line manager does not get their report's personal documents.** `canViewHrDocument` takes
  no manager id at all, so the rule cannot drift: a contract or a disciplinary letter follows
  the identity band, not the employment band, even though a job title follows the latter.
- **Private one-to-one notes are withheld from the employee they are about**, including when
  that employee is otherwise entitled to the record. The subject is excluded before any other
  branch of `canViewOneToOnePrivateNotes`.
- **A one-to-one cannot be recorded with oneself**, and an **appraisal's two halves are two
  predicates** — an employee writes their own self-review and nothing else; the manager writes
  the review and the rating and not the self-review.
- **Recognition is unscoped on purpose.** Anyone may recognise anyone except themselves.
- **Anonymous survey responses store no identity and write no audit entry.** See
  `docs/data-model.md`; both would reconstruct the link the schema refuses to keep.
- Tests: `tests/hr/performance-flow.test.ts`, which includes reading `survey_responses`
  directly to confirm the identity column is null in the database rather than merely filtered
  out on the way to the screen.

### HR: rotas, timesheets and expenses

| Action | Self | Line manager | Finance user | HR_ADMIN | Other roles | SECURITY_ADMIN |
|---|---|---|---|---|---|---|
| View shifts | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Create / publish shifts | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Offer own shift for swap | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Accept an offered shift | ✅ (anyone offered) | ✅ | ✅ | ✅ | ✅ | ❌ |
| Approve a swap | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Clock in/out | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Correct a clock event | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Record / submit own hours | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Approve a timesheet | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| View an expense claim | ✅ | ✅ | ✅ (all) | ✅ | ❌ | ❌ |
| Add to / submit a claim | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Approve a claim | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Mark a claim paid | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |

- **Nobody approves their own** hours, spend, or shift swap. Each of those predicates excludes
  self before any other branch, the same rule leave approval uses.
- **Approving a claim and marking it paid are different permissions held by different people.**
  Approval says the spend was legitimate; payment says money left the account. One person doing
  both unchecked is the classic expenses control gap, so a line manager can approve and cannot
  pay, and a finance user can pay.
- **A shift swap needs two separate acts**: the colleague accepts, then a manager approves, and
  only the approval moves the rota. Neither party to the swap can approve it.
- **Clocking is self-only.** A clock record somebody else made is not a clock record; a manager
  fixing a mis-clock writes a correction that is marked as one.
- **Finance users see company-wide spend**, the same widening their pay access gets, and still
  get no employment or identity detail.
- Tests: `tests/hr/work-flow.test.ts` (swap two-step, clock state machine, timesheet approval,
  the approve/pay split, and mileage charged at the rate in force on the journey date) and
  `tests/hr/money.unit.test.ts` (the arithmetic, including the penny-loss and band-crossing
  traps).

### HR: learning, health and safety, recruitment

| Action | Self | Line manager | Hiring manager | HR_ADMIN | Everyone | SECURITY_ADMIN |
|---|---|---|---|---|---|---|
| Browse the course catalogue | — | — | — | ✅ | ✅ | ❌ |
| Add or archive a course | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Assign a course | ✅ (own) | ✅ (reports) | — | ✅ | ❌ | ❌ |
| Record course progress | ✅ | ❌ | — | ✅ | ❌ | ❌ |
| View someone's training | ✅ | ✅ | — | ✅ | ❌ | ❌ |
| Read risk assessments | — | — | — | ✅ | ✅ | ❌ |
| Write a risk assessment | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Report an incident or hazard | — | — | — | ✅ | ✅ | ❌ |
| Read the incident log | — | — | — | ✅ | ✅ | ❌ |
| Read incident **injury detail** | ✅ (own) | ❌ | ❌ | ✅ | ❌ | ❌ |
| Investigate / set RIDDOR flag | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| See open vacancies | — | — | — | ✅ | ✅ | ❌ |
| Open or close a vacancy | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| See and manage candidates | ❌ | ❌ | ✅ (own vacancy) | ✅ | ❌ | ❌ |
| Create an employee record from a hire | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |

- **Only the learner records their own progress.** A manager marking their report's course
  complete is a fiction, and a training record nobody can rely on is worse than none.
- **Anyone can report anything, and everyone can read the log.** A reporting channel with a
  permission tier does not get used, and under-reporting is the failure mode safety systems
  actually have. Risk assessments are equally open: a control measure nobody can read protects
  nobody.
- **Injury detail is the exception.** It is health data about a named person, so it follows
  the same rule as sickness — the person involved and HR. An incident naming nobody carries no
  personal data and is not restricted. Redacted per row in the query, not in the component.
- **The audit entry for an incident records kind and location only**, never injury detail —
  the audit log is readable by SECURITY_ADMIN, who is walled off from health data.
- **Candidates are scoped to HR and the named hiring manager**, not to the line-management
  chain, because a candidate is not an employee and has no place in it.
- **Creating an employee record from a hire is narrower than managing the application.**
  Moving someone to "hired" is a recruitment decision; creating an account and an employment
  record has payroll and access consequences, so it is HR's act and a separate, deliberate
  step rather than a side effect of a status change.
- Tests: `tests/hr/growth-flow.test.ts`, covering the learner-only progress rule, injury
  redaction per role, the risk banding, and the hired-to-employee hand-off including its
  refusal to run twice or before the candidate is hired.

### HR: reporting and payroll export

| Action | Finance user | HR_ADMIN | Every other role | SECURITY_ADMIN |
|---|---|---|---|---|
| Aggregate HR reports (headcount, turnover, absence, leave, burnout) | ❌ | ✅ | ❌ | ❌ |
| Demographic breakdowns | ❌ | ✅ | ❌ | ❌ |
| Payroll CSV export | ✅ | ✅ | ❌ | ❌ |

- **The reports page allows either capability and each section checks its own.** A finance
  user reaches the payroll export and sees none of the aggregate reporting above it; an
  HR_ADMIN sees both. Neither is inferred from the other.
- **Payroll export stacks three controls**, and they are layered rather than alternatives:
  `canExportPayroll`, then `requireStepUpAuth` for a fresh authenticator code, then an audit
  entry. Permission alone is not enough for a file containing everyone's pay changes.
- **A refused export is audited too.** A refusal nobody records is a refusal nobody can
  review, so `result: 'denied'` is written before the error is thrown.
- **The audit entry records the period and a row count, never the contents.** An audit log
  that reproduces the export is a second copy of the thing being protected.
- **Small groups are suppressed in demographic reporting** — under five people are collapsed
  into one row, because a category of one is an individual's record, not a statistic.
- Tests: `tests/hr/payroll-export.test.ts`, covering refusal for EMPLOYEE/MANAGER/ADMIN,
  refusal for an entitled caller without a recent step-up, the audit entries on both paths,
  and CSV formula-injection escaping.
