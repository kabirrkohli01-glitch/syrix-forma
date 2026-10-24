# SYRIX Forma — engineering rules

The standing rules this codebase is built to. Comments in the source cite them by number
("engineering rule 10"). `DEPENDENCIES.md` records every dependency decision they require.

## Constraints

- **Local now, cloud later.** The platform is architected from the start for multiple users,
  multiple devices and real authentication, and is deployed to a live host only once it is
  stable.
- **Development convenience is fine — a shipped bypass is not.** A seeded, development-only
  session is gated strictly behind `NODE_ENV=development` and is never reachable in a
  deployed build.
- **Free tiers only, verified rather than assumed.** A service's actual terms are checked
  before it is treated as free: "free tier" and "free for this use" are not always the same
  thing (a hobby hosting tier that bans commercial use, for example). Every dependency's
  free-tier ceiling is logged in `DEPENDENCIES.md`.

## 0. Documents in this repository

- **docs/engineering-rules.md** — these rules.
- **DEPENDENCIES.md** — one entry per real dependency: what, why, licence, repository link.
- **docs/** — data model, permissions matrix, data classification, threat model, and the
  design of the assistant.

## 1. Project identity

- SYRIX Forma is a private, internal operating platform for an organisation's own staff.
  Not a public CRM, a generic project-management clone or a demo.
- It exists to remove remembering, chasing, copying and manual follow-up — where that is
  safe and deterministic.
- **Automation is rule-driven. AI suggests. Humans and explicit rules decide.**

## 2. Source of truth

- The platform owns what it creates: tasks, clients, projects, workflow state, audit trail.
- External systems (calendar, mail, Microsoft 365, SharePoint/OneDrive/NAS) stay
  authoritative for their own data; the platform stores references and sync state.
- **A dead integration degrades a feature — it never takes down the app.**

## 3. Device and responsive design

- One responsive web app for desktop, laptop, phone and tablet, on one backend and one
  account system.
- Desktop: persistent sidebar, larger tables, multi-column layouts.
- Mobile: compact navigation, responsive cards, touch-friendly controls, fast access to
  urgent work.

## 4. Theming

- Light, Dark and System modes; the preference persists per user.
- Light: light surfaces, a restrained blue accent, strong typography, subtle borders.
- Dark: charcoal and navy, slightly lighter panels, the same restrained accent. **Not a simple
  inversion of light mode** — both are designed intentionally.
- No sci-fi aesthetic, no glow effects, no decorative animation.

## 5. Primary navigation

`HOME | MY WORK | CLIENTS | PROJECTS | CALENDAR | EMAIL | TEAM CHAT | DOCUMENTS | TEAMS |
HR | AUTOMATIONS | REPORTS | SYRIX AI | SETTINGS`

The shell for every section exists from the start, even where a section is not built yet, so
the structure is never re-architected later. A disabled item is fine; one bolted on later is
not. Team Chat is participant-gated rather than role-scoped — see `docs/permissions-matrix.md`.

## 6. Repository layout and workflow

```
apps/web/
├── app/                # routes only — no business logic here
├── components/         # presentational, reusable
├── features/           # one folder per feature
├── lib/
│   ├── auth/
│   ├── db/
│   ├── permissions/    # server-side permission checks live here, nowhere else
│   └── integrations/   # one adapter per external system
└── tests/
packages/shared/        # shared types and schemas
docs/
```

- Business logic never lives in a route file; routes call into `features/` or `lib/`.
- `.env.example` lists every variable with no real values. `.env` is never committed.
- Configuration is ready for development, staging and production separation from the start.
- Every commit passes `npm run typecheck`, `npm run lint` and `npm test`. One logical change
  per commit, with a `type(scope): what changed` message.

## 7. No fake work

- A stub is never marked complete; nothing is called "tested" or "working" without having
  been run, with output to show.
- No dependency, API or repository is named without verifying it is real.
- Fake data is never silently substituted for a real integration — stubs are labelled loudly.
- No empty or swallowed `catch` blocks, no decorative complexity, no "god files", no
  copy-pasted CRUD across near-identical routes.

If in doubt: smaller, real and boring beats big, fake and impressive.

## 8. Reuse before rebuild

**Search → inspect → compare → reuse or adapt → test.** Maintenance, licence, dependency tree
and security history are checked before anything is added. Real packages are used rather than
vendored copies, and every non-trivial dependency has an entry in `DEPENDENCIES.md`.

| Layer | Approach |
|---|---|
| Buttons, forms, modals, tables, icons, drag and drop | Reuse (shadcn/ui, TanStack Table, Tabler Icons, dnd-kit) |
| Authentication UI | Reuse carefully (Clerk) |
| Permission enforcement, client workflow, automation rules, audit | Built for this platform |
| Integration adapters | Mostly custom, thin |

## 9. Locked tech stack

- **Starting shell:** `next-shadcn-dashboard-starter` (Next.js, shadcn/ui, TypeScript,
  Tailwind, MIT), with its demo content stripped.
- **UI:** shadcn/ui · **Tables:** TanStack Table · **Data fetching:** TanStack Query ·
  **Drag and drop:** dnd-kit · **Icons:** Tabler Icons
- **Auth:** Clerk (MFA, sessions, organisations).
- **Database:** PostgreSQL through one typed query layer, Drizzle.
- **Queue:** BullMQ on Redis.

Changing any of these needs a written reason in `DEPENDENCIES.md`.

## 10. Roles and permissions

| Role | Scope | Key permissions |
|---|---|---|
| EMPLOYEE | Own work | Own tasks, assigned clients, create/edit own items |
| TEAM_LEAD | Team | + assign within team, view team workload |
| MANAGER | Cross-team | + cross-team client/project visibility, basic reports |
| ADMIN | Platform | User and role management, integrations, automation kill-switch |
| SECURITY_ADMIN | Security only | Sessions, audit log, security events — not general business data |
| HR_ADMIN | HR records only | Employee records, pay, leave, absence, HR settings — deep, not wide |

Two capabilities sit alongside a role rather than replacing it, because an employee holds
exactly one role:

| Capability | Grants |
|---|---|
| `financeAccess` | Pay figures and expense amounts across the company, and nothing else |
| `hrAdmin` | Everything HR_ADMIN grants, for an ADMIN who must keep user management |

Both are step-up authenticated and audited like a role change, are cleared when an account is
disabled, never widen business-data scope, and can never be held by a SECURITY_ADMIN.

- Permissions are resource-level **and** action-level. **Every check happens server-side** —
  hiding a button is not a control. A hand-crafted API call gets the same answer as the UI.

## 11. Security baseline

- Authentication, passwords and sessions via Clerk — never hand-rolled.
- TLS in transit; encryption at rest; parameterised queries only.
- Cookies are `HttpOnly`, `Secure` and `SameSite`, rotated on privilege change, with idle and
  absolute timeouts. CSRF protection and rate limiting on authentication endpoints.
- Schema-based input validation (Zod) at the API boundary.
- No secret in a client bundle, log line or commit. Least-privilege service accounts.
- The audit log records who, when, what, resource and result, is append-only and
  tamper-evident, and **never** stores passwords, API keys, session tokens or AI prompt
  content.
- CI on every change: lint (oxlint), typecheck (tsc), tests (Vitest against a throwaway
  Postgres container), dependency scanning (`npm audit`, OSV-Scanner), secret scanning
  (gitleaks) and static analysis (Semgrep).

Before real client data is stored, a full OWASP ASVS pass, a zero-trust review and an
independent security review are required — compliance is never claimed without them.

## 12. Untrusted input and production access

- Development uses scoped, development-only credentials — never unrestricted production
  database or API credentials.
- Any action that touches production data, sends a real message to a real person or changes
  a live permission requires explicit human approval first.
- All external content (emails, web pages, uploaded documents, client messages) is
  **untrusted input**. Instructions embedded in it can never trigger a privileged action
  without a human explicitly authorising it. This applies directly to the assistant.

## 13. Testing

Every feature has unit and integration tests and an authorisation test that actually tries the
wrong-permission path. A failing test gets fixed, never deleted to turn CI green.

## 14. Design system

One shared set of tokens for typography, spacing, colour, radius and shadow; no page invents
its own button style. It must not look like an untouched dashboard template. Motion is
purposeful — hover and focus states, loading skeletons, subtle route transitions — never
decorative.

## 15. Performance

- Paginate; never load a whole company's data for one page.
- Virtualise long lists and tables; cache and lazy-load where it does not hide staleness.
- Queue heavy work (BullMQ) instead of blocking a request.
- Optimistic updates only where a rollback is safe and visible.
- Index every column used in a `WHERE`, `JOIN` or `ORDER BY` on a growing table.

## 16. Accessibility

Keyboard navigation and visible focus everywhere, sufficient contrast, semantic HTML and ARIA
labels, screen-reader-sensible structure, reduced-motion support and touch-sized targets.

## 17. UX rule

Every screen lets the user answer: *what am I looking at → what can I do here → what needs my
attention → what happened → what happens next.*

## 18. Definition of done

Not done because the UI looks good or the build succeeds. Done when it works, permissions are
correct, unit, integration and authorisation tests pass, error, empty, mobile and dark states
work, no secret leaked, the decision is documented, CI passes including secret and dependency
scanning, and it behaves correctly when its dependencies fail.

## 19. Priorities

**Correctness → security → reliability → usability → performance → aesthetics.**
