# SYRIX FORMA — DEPENDENCY LOG

One entry per non-trivial dependency. Update this file in the same commit that adds the
dependency. If it's not logged here, it shouldn't be in the codebase — that's the check for
"reuse before rebuild" actually happening instead of just being a rule on paper.

Licenses/links below were verified at time of writing. Confirm the current LICENSE file in
each repo before shipping — don't take this document's word for it forever.

## Starting shell

**Kiranism/next-shadcn-dashboard-starter** — https://github.com/Kiranism/next-shadcn-dashboard-starter
- What: Next.js 16 + shadcn/ui (on Base UI) + TypeScript + Tailwind v4 admin dashboard
  starter. Ships with Clerk auth, Sentry, Zod, TanStack Query/Table/Form, Nuqs.
- Why: avoids building the shell (nav, tables, auth wiring) from scratch.
- License: MIT. Attribution copy kept at
  `THIRD_PARTY_NOTICES/next-shadcn-dashboard-starter-LICENSE.txt`.
- Note (Phase 0, done): stripped the starter's demo modules — Product/User CRUD, fake
  dashboard stats, Kanban/Chat/AI-chat/Notifications demos, Clerk Organizations/Billing demo
  pages (workspaces/billing/exclusive — SYRIX Forma is single-tenant, not multi-org SaaS), the
  multi-brand theme picker (Discord/WhatsApp/etc. skins), and the GitHub star CTA. Only the
  bare shell + Clerk auth + design tokens remain, per the build plan Phase 0.
- Note: `zustand`, `motion`, `uuid`, and `dnd-kit` shipped with the starter but were only used
  by the removed demos (chat/kanban/notifications) — dropped for now rather than kept unused.
  `dnd-kit` gets re-added in Phase 2 when the real Task Board view needs it (still the locked
  choice below); the others get added only if a real feature ends up needing them.

## UI

**shadcn/ui** — https://github.com/shadcn-ui/ui
- What: component source (copied into the project, not a runtime package).
- Why: already the starter's component layer; MIT, widely maintained.
- License: MIT.

**Tabler Icons** — https://github.com/tabler/tabler-icons (via `@tabler/icons-react`)
- What: icon set. **Deviates from engineering rule 9's original Lucide choice — logged here
  per that section's own rule.**
- Why: the locked starter ships every component pre-wired to Tabler (`components.json`'s
  `iconLibrary`, and a ~90-icon barrel already built in `components/icons.tsx`). Both are
  simple line-icon sets under permissive licenses; re-wiring ~250 icon references to Lucide
  for a cosmetically equivalent library would be pure churn with no user-facing benefit.
- License: MIT.

**dnd-kit** — https://github.com/clauderic/dnd-kit
- What: drag-and-drop toolkit — `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`,
  `@dnd-kit/utilities@3.2.2`. Reinstalled Phase 2 for the real Task Board view, per the note
  above (removed with the demo Kanban board at Phase 0).
- Why: needed for the Board view (Phase 2) and Kanban-style workflows (Phase 5).
- License: MIT (all three packages).
- Security considerations: `npm audit` reports 4 moderate findings after this install, but
  they're the same pre-existing `drizzle-kit`/`@esbuild-kit` dev-tooling advisory
  (GHSA-67mh-4wv8-2f99) already logged under Drizzle ORM above — confirmed unrelated to
  dnd-kit itself (dnd-kit adds no new advisories).

**Sentry (`@sentry/nextjs`)** — https://github.com/getsentry/sentry-javascript
- What: error tracking, wired into `next.config.ts` and `instrumentation.ts`.
- Why: already wired by the starter; kept disabled locally (`NEXT_PUBLIC_SENTRY_DISABLED=true`
  in `.env.example`) until a real Sentry project/DSN exists — never sends data without one.
- License: MIT.

## Data

**TanStack Table** — https://github.com/TanStack/table
- Why: already included via the starter; headless, works with the organisation's own styling.
- License: MIT.

**TanStack Query** — https://github.com/TanStack/query
- Why: already included via the starter; caching/sync for server data.
- License: MIT.

**Drizzle ORM** — https://github.com/drizzle-team/drizzle-orm
- Decision (Phase 0): Drizzle over Prisma; logged then per Section 9's "pick one at Phase 0"
  rule. Installed Phase 1 alongside the `employees`/`audit_log` tables.
- Why: SQL-forward and TypeScript-first with no separate codegen daemon or query-engine
  binary at runtime — lighter footprint for a small internal app that self-hosts later
  (the engineering rules' "local now, cloud later" plan), and its migration files are plain, reviewable
  SQL rather than Prisma's proprietary schema DSL.
- License: Apache-2.0.
- Includes `drizzle-kit` (migrations CLI, dev-only) and `postgres` (postgres-js driver,
  `prepare: false` required against Neon's pgbouncer pooler endpoint).
- Known issue: `drizzle-kit`'s bundled `@esbuild-kit/esm-loader` pulls in an `esbuild` version
  with a moderate dev-server-only CORS advisory (GHSA-67mh-4wv8-2f99). Only reachable via
  `drizzle-kit`'s own local tooling, never shipped or exposed in the built app. The only fix
  is downgrading `drizzle-kit` to 0.18.1, a real regression — tracked here as an accepted risk
  instead, revisit when upstream releases a fix.

**Neon** — https://neon.tech
- What: managed serverless Postgres. `DATABASE_URL` in `.env.local`, never committed.
- Why: named in engineering rule 9/free-tier list; genuinely free tier at this scale.
- License: n/a (hosted service). Confirm current ToS/free-tier limits before scaling usage.

**Vitest** — https://github.com/vitest-dev/vitest
- What: test runner. Nothing existed in the repo before Phase 1 — required for the
  authorization test the build plan Phase 1 mandates.
- Why: fast, native ESM/TS support, no separate Babel/webpack config needed alongside Next.js.
- License: MIT.

## Auth

**Clerk** — https://github.com/clerk/javascript
- What: hosted auth — sign-in/up, session management, Organizations.
- Why: already wired into the starter; Organizations map onto the organisation's Teams model without
  hand-building multi-tenancy from scratch.
- Note: Clerk is a paid hosted service beyond its free tier — check current pricing before
  committing. Self-hosted fallback if that becomes a problem: Auth.js —
  https://github.com/nextauthjs/next-auth (more manual session work required).
- **Confirmed (Phase 1, checked live against clerk.com/pricing): the free Hobby tier does NOT
  include MFA** — it's Pro-plan only ($25/mo+), which breaks the engineering rules' "never pay" rule.
  This was flagged as an open risk in Section 9/11 ("confirm MFA is on the free tier"); it
  isn't. Resolved by layering our own TOTP second factor on top of Clerk's free sign-in (see
  `otpauth` entry below) rather than paying for or migrating off Clerk. Checked Supabase Auth
  as a free-MFA alternative too — its free tier does include basic TOTP MFA, but adopting it
  would mean replacing the whole Clerk integration already built and tested; not worth it for
  this alone.

**otpauth** — https://github.com/hectorm/otpauth
- What: TOTP/HOTP generation and verification (RFC 6238/4226), zero runtime dependencies.
- Why: Clerk's free tier has no MFA (see above) — this provides the second factor instead.
  Compatible with any standard authenticator app (Google Authenticator, Authy, 1Password, etc.)
  via the standard `otpauth://` URI format.
- License: MIT.
- Security notes: the TOTP secret is encrypted at rest (AES-256-GCM, key derived via HKDF from
  `MFA_ENCRYPTION_KEY`) in `employees.mfa_secret_encrypted` — never stored in plaintext. Failed
  challenge attempts are rate-limited (5 attempts / 15-minute lockout) per the engineering rules Section
  11's "rate limiting on auth endpoints" requirement. Verification code:
  `apps/web/lib/auth/{mfa-crypto,mfa-keys,mfa-session-cookie,totp}.ts`.

## Background jobs

**BullMQ** — https://github.com/taskforcesh/bullmq
- What: Redis-backed job queue.
- Why: needed for Phase 3's automation engine (retries, idempotency, dead-letter handling).
- License: MIT.
- Requires: a Redis instance (see Upstash below). Also requires `ioredis` (`bullmq`'s Redis
  client is an optional peer, not bundled — installed separately).

**Upstash** — https://upstash.com
- What: managed serverless Redis, free tier. `REDIS_URL` in `.env.local`, never committed.
- Why: named in engineering rule 9/free-tier list; same free-tier pattern as Neon. Connects
  over TLS (`rediss://`) even from local dev — no self-hosted Redis needed at any stage.
- License: n/a (hosted service). The free-tier signup flow prompts for a plan selection; confirm
  the free plan is actually selected (not a paid default) before creating the database — the
  same "free tier isn't always the default" trap the engineering rules calls out for hosting.
- Verified live this session: BullMQ `Queue`/`Worker` round-tripped a real job end-to-end against
  a live Upstash instance.

**Resend** — https://github.com/resend/resend-node
- What: transactional email API, used for task-reminder/assignment/automation-failure emails
  (Phase 3).
- Why: genuinely free tier (100 emails/day, 3,000/month, no card required at signup) —
  confirm current terms before relying on it long-term. Simple API, official Node SDK.
- License: MIT (the `resend` npm SDK; the underlying API is a hosted service, ToS apply
  separately).
- `NOTIFICATIONS_FROM_EMAIL` uses Resend's shared sandbox address (`onboarding@resend.dev`) for
  local dev since no domain is verified yet — real deployment will need a verified sending
  domain.

## UI polish

**motion** — https://github.com/motiondivision/motion
- What: animation library (`motion/react`), used for a handful of short mount
  transitions (`components/motion/fade-in.tsx`, `stagger-list.tsx`) — fade + 6px
  rise, 150–250ms, ease-out only. No spring/bounce presets used.
- Why: reversing the Phase 0 decision to drop it as an unused starter dependency
  — that note explicitly said "added only if a real feature ends up needing
  them," and the UI polish pass is that real feature. Reused for the Home
  dashboard redesign and shared layout components rather than hand-rolling CSS
  keyframes for every call site.
- License: MIT.
- Respects `prefers-reduced-motion` via `useReducedMotion()` — falls back to a
  plain unanimated `div`, per engineering rule 16.

## Team Chat

**@aws-sdk/client-s3** / **@aws-sdk/s3-request-presigner** —
https://github.com/aws/aws-sdk-js-v3
- What: S3-compatible client used against Cloudflare R2 (R2 implements the S3
  API) to issue presigned upload URLs for chat attachments.
- Why: Team Chat needs real file storage and none existed in the repo before
  (everything else is reference-only links, per `documentLinks`). R2's own docs
  recommend the AWS SDK for its S3-compatible endpoint rather than a bespoke
  client. See `lib/storage/r2.ts`.
- License: Apache-2.0.
- Storage provider: **Cloudflare R2** (free tier: 10GB storage, no egress
  fees) — consistent with the engineering rules' existing Cloudflare-Tunnel hosting
  note. Requires a bucket + API token created by hand in the Cloudflare
  dashboard (not something an agent can provision) — env vars in
  `.env.example`: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET_NAME`. Verify current free-tier terms before relying on it long
  term, per Section 9.
- Local dev fallback: `lib/storage/local-dev.ts` writes to a gitignored
  `.local-uploads/` folder when `NODE_ENV=development` and no R2 env vars are
  set — never reachable once deployed, same pattern as the seeded dev session
  the engineering rules' "Constraints" section already sanctions.

## Integrations (Phase 4)

**Hostinger Mail API** — https://api.mail.hostinger.com (docs: https://docs.hostinger.com/api-reference/overview, https://github.com/hostinger/mail-api)
- What: real, documented REST API for Hostinger-hosted mailboxes — search/read/send/reply,
  plus a webhook subscription (`message.received`) per mailbox. Verified live via WebFetch this
  session (not assumed): bearer-token auth (`Authorization: Bearer <token>`, generated in
  hPanel → Emails → API, scoped to one or all mailboxes), `POST /api/v1/mailboxes/{id}/
  folders/{folder}/messages/search` for search, `POST /api/v1/mailboxes/{id}/send` for send/
  reply (`inReplyTo` handles threading). Webhook auth is a per-webhook bearer token echoed on
  every delivery (`Authorization` header), not an HMAC body signature — verified with a
  constant-time comparison (`lib/integrations/hostinger-mail/webhook.ts`).
- Why: this is what the build plan Phase 4 actually requires for the Email integration.
  Deliberately called via plain `fetch` (`lib/integrations/hostinger-mail/client.ts`) instead of
  Hostinger's official Node SDK — the surface used is three endpoints (search/send/webhook
  verification), and a hand-rolled client keeps the dependency list smaller with no real loss of
  capability at this scale. Revisit if the surface grows enough that the SDK's typed request/
  response models start paying for themselves.
- License: n/a (hosted service). No npm package added for this — see above.
- Security considerations: the API token, mailbox resource ID, and webhook bearer token are
  never stored as plain environment variables — an ADMIN pastes them into Settings >
  Integrations, and they're encrypted at rest (AES-256-GCM, `lib/integrations/crypto.ts`, same
  HKDF-derived-key construction as `otpauth`'s TOTP secret above, domain-separated by info
  string so the two never share derived key bytes). Never logged (engineering rule 11).

## CI (`.github/workflows/ci.yml`, Phase 2)

**OSV-Scanner** — https://github.com/google/osv-scanner (action: google/osv-scanner-action)
- What: cross-ecosystem vulnerability scanner against OSV's database, run via Google's
  reusable workflow against `apps/web/package-lock.json`.
- Why: belt-and-suspenders alongside `npm audit` — two independent vulnerability databases,
  no signup required.
- License: Apache-2.0.

**gitleaks** — https://github.com/gitleaks/gitleaks
- What: secret scanner, run as the plain CLI via `docker run zricethezav/gitleaks:latest`
  directly in the workflow, not the marketplace Action wrapper.
- Why: the CLI itself is unambiguously free forever (MIT); the maintained *Action* wrapper has
  an org-account licensing nuance for private repos that wasn't independently verifiable when
  this was written — sidestepped entirely by running the CLI as a plain step instead.
- License: MIT.

**Semgrep OSS** — https://github.com/semgrep/semgrep
- What: static analysis (SAST), installed via `pip install semgrep`, run with the `p/ci`,
  `p/owasp-top-ten`, `p/typescript`, `p/react` rulesets.
- Why: **not CodeQL** — verified live (2026): GitHub Code Security (CodeQL's code-scanning
  upload) has no free tier for private repositories, $30/active-committer/month. Semgrep OSS is
  genuinely free for private repos with equivalent OWASP-Top-Ten-shaped coverage. Revisit if
  GitHub's private-repo pricing changes.
- License: LGPL-2.1 (the OSS CLI/engine — not the paid Semgrep Cloud Platform, which isn't used
  here).

---

## SYRIX AI (Phase 7)

**playwright-core** — https://github.com/microsoft/playwright
- What it does: drives a headless Chromium for the research pipeline's search and page
  navigation (`apps/web/lib/ai/research/browser.ts`). Used as a FALLBACK only — plain HTTP is
  tried first and is enough most of the time; the browser is reached when an engine serves a
  challenge page or a site renders its content with JavaScript, which an HTTP fetch returns as
  an empty shell.
- Why we picked it (and what we rejected instead): **a paid search API was the alternative and
  was rejected on the free-only constraint** in engineering rule 1. Brave/Serper/SerpAPI all
  meter searches, and their free tiers are small enough that a working day of research would
  exhaust them. Driving a real browser over the same public pages costs nothing per query.
  `playwright-core` rather than `playwright` because the latter bundles browser binaries for
  every engine at install time; only Chromium is needed and it is installed explicitly with
  `npx playwright install chromium`. Puppeteer was the other candidate — comparable for this
  job, but Playwright's `context.route` interception is what makes the address sandbox
  enforceable at the network layer rather than only on the entry URL.
- License: Apache-2.0.
- Version pinned: `playwright-core` ^1.x (see `apps/web/package.json`).
- Security considerations: **the model partially chooses these URLs, so this is SSRF surface.**
  Every request the page makes — including ones its own scripts initiate — is intercepted,
  resolved, and refused if it points at loopback, RFC1918, link-local (incl. the
  169.254.169.254 metadata endpoint), CGNAT or a non-http scheme. Contexts are created with no
  storage state and destroyed per session, so no cookie or profile carries in or out and there
  is no logged-in state to leak. Downloads, service workers, popups, images, media and fonts are
  all blocked. Chromium's own sandbox stays enabled. **No bot-defence handling**: a site that
  presents a challenge is recorded as blocked and skipped — nothing solves a challenge, rotates
  identity to evade one, or retries to wear one down. Verified by
  `npx tsx scripts/ai-probe.ts browse` (sandbox self-test).
- Deployment note: adds ~150MB of Chromium to the runtime image. Confirm the chosen host allows
  it before Phase 9 — a host that cannot run Chromium degrades research to the HTTP path rather
  than breaking it, but that tradeoff should be a decision rather than a discovery.

---

## Template for new entries

**[name]** — [real GitHub URL, verified before writing it down]
- What it does:
- Why we picked it (and what we rejected instead):
- License:
- Version pinned:
- Security considerations:

## Xero payroll integration — evaluated and NOT adopted (HR module, Stage 6)

**Decision: not integrated. CSV export used instead.**

the engineering rules' never-pay constraint requires checking a service's actual terms rather than
assuming a free tier covers the intended use. Xero retired free API access on 2 March 2026 and
moved developers onto tiered pricing.

- Xero's published developer pricing does include a **Starter tier at no charge**: up to 5
  connections, 1,000 API calls per organisation per day. The organisation needs one connection, so the
  connection limit is not the problem.
- The pricing page does **not** state whether the **Payroll** API is included at that tier.
  Third-party reporting describes a separate per-business fee for payroll integration
  specifically.
- Source checked: https://developer.xero.com/pricing

"Free tier" and "free for this use" are not the same thing — the exact trap Section 1 of
the engineering rules calls out. A free path for the Payroll API was **not confirmed**, so the integration
was not built and was not stubbed either (Section 7: no fake integrations).

What ships instead is a CSV export of payroll changes, which meets the actual requirement —
getting the period's starters, leavers, unpaid leave, approved expenses and approved hours
into whatever payroll system the organisation runs — with no dependency, no account, and no cost.

**To revisit this, the question is narrow**: is the Xero Payroll API reachable on the $0
Starter tier, or does it carry its own per-business fee? If it is free, the adapter belongs in
`lib/integrations/xero/` behind the same interface as `hostinger-mail`, and must degrade to
the CSV export when unavailable rather than failing the page (Section 2).
