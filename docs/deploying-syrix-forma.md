# Deploying SYRIX Forma

How SYRIX Forma goes on the internet, what protects it there, and what is still open.

This is the build plan Phase 9's "moves off local dev onto the real, free-tier cloud setup".
Read the engineering rules' "Constraints" first — the free-tier rule is a
constraint on this document, not a preference.

---

## 1. Why not a PaaS, and why not Cloudflare Workers

SYRIX Forma needs three things at once that rule most free hosting out:

- **An always-on Node server.** `proxy.ts` runs on Node (Next.js 16 removed the Edge option for
  proxy files) and the app uses `node:crypto`, a Postgres driver and `sharp`.
- **A second long-running process.** The BullMQ worker drives automations, task due-date scans,
  Hostinger Mail reconciliation and document-link reachability. A Worker is not a request
  handler and cannot live inside one.
- **Optionally, a headless Chromium** for SYRIX AI's research lane.

That rules out **Cloudflare Workers and Pages** — they cannot run any of the three, with or
without an adapter. Cloudflare is still central to this deployment, just not as the compute:
it provides the tunnel, the identity gate in front of the app, the WAF, and R2 for files.

It also rules out **Vercel's Hobby tier**, though for a different reason: its terms forbid
commercial use, and a company's internal tool is commercial even with no revenue attached
(the engineering rules). Free tiers that sleep after inactivity (Render's, among others) are a poor fit
too — a sleeping instance runs no worker, so reminders and reconciliation silently stop.

**The shape that works: the app runs on hardware the organisation controls, and Cloudflare puts it on the
internet safely.** No public IP, no port forwarding, no inbound firewall rule.

---

## 2. The layers, outermost first

A request reaches real data only after passing all five. Each one is independent — none of them
is trusted to have done another's job.

| # | Layer | What it stops | Where it lives |
|---|---|---|---|
| 1 | **Cloudflare edge** — WAF, DDoS, bot protection, TLS | Volumetric attack, scanners, anyone who never gets a TLS handshake | Cloudflare dashboard |
| 2 | **Cloudflare Access** | Anyone not on the allow-list reaching even the sign-in page | Cloudflare Zero Trust |
| 3 | **Cloudflare Tunnel** | Any inbound connection at all — the machine has no open port | `cloudflared` container |
| 4 | **Clerk session + TOTP MFA** | Someone with no account, or a password without the second factor | `app/dashboard/layout.tsx` |
| 5 | **The Hub's own gate** | A signed-in account that is pending, refused, disabled, or lacks the permission | `lib/permissions/` |

Layer 2 is worth being explicit about. **Cloudflare Access is a second, independent front door
that Clerk knows nothing about.** Someone who stole a Clerk password still meets it, and someone
removed from the Access list cannot reach the application even if their Hub account is somehow
still valid. It is free for up to 50 users, and it is the single largest security gain available
here for no money.

Layers 4 and 5 are the ones that already existed and are already tested; 1–3 are what this
deployment adds.

---

## 3. What is needed before the first deploy

Four things, and three of them can only be done by the account owner.

### 3.1 A domain — the one hard blocker

Everything in layers 1–3 needs a DNS zone in the Cloudflare account, and so does Clerk:

- A **named Cloudflare Tunnel** routes a hostname, and the hostname must be in a zone you
  control. (A "quick tunnel" gives a random `*.trycloudflare.com` name that changes on every
  restart. It is for demos and is not a way to run a company's tool.)
- **Cloudflare Access** policies are attached to a hostname, same requirement.
- **Clerk production instances require CNAME records** on your own domain, for the frontend API,
  the account portal and email. There is no Clerk-hosted alternative.

Adding a domain you already own to Cloudflare is free. Without one, the deployment is stuck on
Clerk **development** keys — see §6.

### 3.2 Clerk production instance

Create it in the Clerk dashboard, add the CNAME records it gives you, and take the new
`pk_live_`/`sk_live_` pair. Then, in that instance:

- **Restrict sign-ups.** Clerk's "Restricted" mode means only people you invite can create an
  account at all. The Hub's own approval queue still applies underneath — this stops the queue
  filling with strangers rather than replacing it.
- **Set session lifetimes.** The defaults are generous. `docs/threat-model.md` lists idle and
  absolute session timeout as outstanding, and this is where they are configured.
- **Point the webhook** at `https://<your-host>/api/webhooks/clerk` and copy the signing secret
  into `CLERK_WEBHOOK_SIGNING_SECRET`.

The app **refuses to boot on `pk_test_`/`sk_test_` keys** (`lib/config/preflight.ts`). Clerk's
development instances share infrastructure between applications and are documented as unsuitable
for production; shipping on one is the most likely way for this deployment to look secure without
being secure, so it is a hard failure rather than a warning.

### 3.3 An R2 bucket

Chat attachments, HR documents and the document library all go through it. Outside development
the storage adapter throws rather than falling back (`lib/storage/index.ts`), and preflight
refuses to boot without all four `R2_*` values, so this is not optional. The bucket must have
**no public read access** — every file is served through a short-lived presigned URL issued only
after the caller's access has been re-checked.

Note for the free-tier rule: R2's first 10 GB are free, but **Cloudflare asks for a payment
method before R2 can be enabled on an account.** No charge follows at this scale; the card is
still a decision for the account owner, not something to assume.

### 3.4 The machine

Anything that stays on and runs Docker. It needs no public IP and no open ports — the tunnel
connects outbound. If it is a laptop that sleeps, the Hub is down while it sleeps, and staff will
experience that as the tool being unreliable.

---

## 4. Deploying

```bash
cd apps/web
cp ../../.env.example .env.production   # then fill it in — every value, see preflight
docker compose up -d --build
```

`.env.production` is gitignored by a wildcard, and the compose file reads secrets from it rather
than holding any itself.

Then, once:

```bash
npm run db:migrate     # against the production DATABASE_URL
```

### Checks that actually tell you something

```bash
docker compose ps                 # all three up; app healthy, not restarting
docker compose logs app --tail 50 # preflight complaints appear here, named individually
docker compose logs worker        # "[worker] ready", then the scheduled jobs registering
npm run doctor                    # who exists, what they hold, whether reference data is there
```

A restart loop on `app` is almost always preflight refusing an incomplete `.env.production`. It
names every missing variable at once rather than the first, so read the log rather than guessing.

---

## 5. Who gets in, and how you find out

This is the flow the deployment exists to make safe.

1. Someone signs in for the first time. Clerk creates the user; the `user.created` webhook
   creates their `employees` row as **`pending`**, which reaches nothing.
2. **Every active ADMIN is told** — in the app (the bell in the header) and by email — with the
   person's name, email, the address the request came from, their browser and platform, and the
   time. Recorded in `sign_in_events` before the redirect that turns them away.
3. The administrator opens **Settings → People & Access**, sees the request with where it came
   from, and either grants a role and team or **refuses** it. Refusing bans the account at Clerk
   so it stops arriving at the gate at all.
4. Both outcomes are step-up authenticated — a fresh TOTP code — and written to the audit log.

Afterwards, an existing employee signing in **from a device this account has not used before**
raises the same alert. Familiar devices do not, so the alert stays worth reading. Alerts are
capped at one per person per hour; `sign_in_events` keeps the complete record regardless.

Everyone gets their own account, their own MFA enrolment, their own dashboard and their own
scoped data. There is no shared session and no way for one person's link to put another person
inside their account.

---

## 6. What is not done

Stated plainly, because a deployment document that implies more protection than exists is worse
than none.

- **Clerk development keys block the deploy.** Until a domain exists, a production Clerk instance
  cannot be created, and preflight will refuse to start. This is deliberate, and it is the one
  thing standing between the current state and a real deployment.
- **The CSP still carries `unsafe-inline` and `unsafe-eval` in `script-src`.** Next.js's inline
  bootstrap and Clerk's component library both need them; removing them needs a per-request nonce
  threaded through the proxy. The directives that stop data leaving — `connect-src`,
  `form-action`, `base-uri`, `frame-ancestors` — carry no exception.
- **The audit log is append-only by convention, not by the database.** No role restriction or
  trigger enforces it.
- **No idle or absolute session timeout** beyond whatever the Clerk instance is set to.
- **No backups or DR test.** Neon's own retention is whatever its free tier gives; nothing has
  been restored from it, and the build plan Phase 9 asks for a real restoration test.
- **No independent penetration test**, and no external reviewer has signed this off. Phase 9's
  "Done when" is not met, and this document does not claim it is.
- **Sentry is disabled** (`NEXT_PUBLIC_SENTRY_DISABLED=true`), so production errors are visible
  only in container logs.
- **SYRIX AI's browser lane is off** unless `FORMA_AI_BROWSER=on` and a Chromium exists on the host.
  Research still works without it; that lane is skipped rather than failing.
