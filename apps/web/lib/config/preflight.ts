/**
 * What must be true before this process is allowed to serve a deployed Hub.
 *
 * Every value checked here was already required by something; the difference is when you find
 * out. Missing storage credentials surfaced the first time somebody attached a file to a message,
 * a missing Resend key the first time an access request needed to reach an administrator — which
 * is precisely the request that must not be dropped silently. A deployment that cannot do its job
 * should refuse to start rather than look healthy and fail on the one path that matters.
 *
 * Local development is exempt by design (the engineering rules' "dev convenience is fine — a shipped bypass
 * is not"): the Hub is meant to run on a laptop with no object storage and no mail provider, and
 * the adapters already degrade to dev-only fallbacks there. The checks below are the other half
 * of that contract — the moment NODE_ENV is not 'development', nothing degrades quietly.
 */

import { accessCodeModeEnabled, describeCodeProblem } from '@/lib/auth/access-code-config';

type Problem = { variable: string; detail: string };

const REQUIRED: Array<{ name: string; why: string }> = [
  { name: 'DATABASE_URL', why: 'every screen reads from Postgres' },
  { name: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', why: 'nobody can sign in without it' },
  { name: 'CLERK_SECRET_KEY', why: 'nobody can sign in without it' },
  { name: 'MFA_ENCRYPTION_KEY', why: 'TOTP secrets and the device cookie are derived from it' },
  { name: 'NEXT_PUBLIC_APP_URL', why: 'alert emails link back to the Hub using it' },
  { name: 'RESEND_API_KEY', why: 'access requests reach an administrator by email' },
  { name: 'NOTIFICATIONS_FROM_EMAIL', why: 'access requests reach an administrator by email' },
  { name: 'REDIS_URL', why: 'the queue, and rate limits that hold across instances' }
];

/**
 * What an access-code deployment needs instead (lib/auth/access-code.ts).
 *
 * The two mail variables drop off the required list here rather than being merely optional: a
 * deployment that opens on a shared code is one being shown to people, and the alerts it would
 * otherwise send all say "somebody signed in" about an account that is not a person. Nothing in
 * this mode should be able to reach outside the application at all.
 *
 * REDIS_URL stays required and the reason changes. Elsewhere it backs the queue; here it is what
 * makes the lockout survive a restart. Without it, a free instance that sleeps and wakes hands
 * anyone guessing the code a fresh set of attempts every time it comes back.
 */
const REQUIRED_IN_CODE_MODE: Array<{ name: string; why: string }> = [
  { name: 'DATABASE_URL', why: 'every screen reads from Postgres' },
  { name: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', why: 'every page renders inside <ClerkProvider>' },
  { name: 'CLERK_SECRET_KEY', why: 'clerkMiddleware runs on every request' },
  { name: 'MFA_ENCRYPTION_KEY', why: 'the access-code session cookie is signed with a key derived from it' },
  { name: 'NEXT_PUBLIC_APP_URL', why: 'links the Hub builds back to itself use it' },
  { name: 'ACCESS_CODE', why: 'there is no other way in' },
  { name: 'ACCESS_CODE_IDENTITY', why: 'the code has to open a specific, already-approved account' },
  { name: 'REDIS_URL', why: 'the lockout on wrong codes has to survive a restart' }
];

/**
 * Object storage is deliberately not in the list above.
 *
 * Enabling R2 requires a payment method on the Cloudflare account even though the first 10 GB
 * are free, and that is a decision for the account owner rather than something a deployment
 * should assume. Every call into storage is inside a Server Action — an upload or a download —
 * and never part of rendering a page, so an unconfigured bucket costs three features and takes
 * nothing else down with it: attaching a file to a message, and uploading or downloading an HR
 * or library document. Everything else, the whole Hub, runs.
 *
 * Refusing to boot over it would trade a working Hub for three buttons.
 */
const OPTIONAL_STORAGE = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME'
] as const;

export function collectConfigProblems(env: NodeJS.ProcessEnv = process.env): Problem[] {
  const problems: Problem[] = [];
  const codeMode = accessCodeModeEnabled(env);

  for (const { name, why } of codeMode ? REQUIRED_IN_CODE_MODE : REQUIRED) {
    if (!env[name]) problems.push({ variable: name, detail: `not set — ${why}` });
  }

  if (codeMode) {
    const codeProblem = describeCodeProblem(env.ACCESS_CODE);
    if (codeProblem && env.ACCESS_CODE) {
      problems.push({ variable: 'ACCESS_CODE', detail: codeProblem });
    }

    // Refused rather than ignored. Leaving a mail credential set in this mode means the next
    // person to read the configuration has to work out from the code whether it is used, and a
    // credential nobody is sure about is one that stays live long after the demonstration ends.
    for (const name of ['RESEND_API_KEY', 'NOTIFICATIONS_FROM_EMAIL']) {
      if (env[name]) {
        problems.push({
          variable: name,
          detail:
            'must not be set on an access-code deployment — this mode is deliberately unable to send or read mail'
        });
      }
    }

    console.warn(
      `[preflight] ACCESS-CODE DEPLOYMENT — sign-in is disabled and one shared code opens the account ${env.ACCESS_CODE_IDENTITY}. Every session is that person: the audit log, approvals and anything recording an author will name them regardless of who is at the keyboard. This is a demonstration mode and is not a substitute for accounts.`
    );
  }

  // A key length that is wrong fails at the point of use, deep inside a crypto call, with a
  // message about buffer sizes rather than about configuration.
  const mfaKey = env.MFA_ENCRYPTION_KEY;
  if (mfaKey && Buffer.from(mfaKey, 'base64').length !== 32) {
    problems.push({
      variable: 'MFA_ENCRYPTION_KEY',
      detail: 'must decode to exactly 32 bytes of base64'
    });
  }

  // Clerk's development instances are not a smaller production: they share infrastructure
  // between applications, accept sign-in from any origin, cap at 100 users, and Clerk documents
  // them as unsuitable for production. Shipping on pk_test/sk_test is the single most likely way
  // for a deployment to look secure and not be, so in production it is refused, not warned about.
  //
  // A staging deployment is the one exception, and it is deliberately awkward to get into. A
  // Clerk production instance requires CNAME records on a domain you control, which is not
  // always available on the day the code is ready; putting real code in front of real browsers
  // before then is normal and useful. So APP_ENV=staging permits development keys — and nothing
  // else about the security model changes. MFA, step-up, the approval gate and every permission
  // predicate run exactly as they do in production, because the dev-only shortcuts in those are
  // keyed on NODE_ENV === 'development', which a staging deployment is not.
  //
  // A staging instance must not hold real employee or client data. That is a rule this file
  // cannot enforce, which is why it is stated on the deployment itself rather than only here.
  // Access-code mode joins staging as the second exception, for a stronger reason than staging's:
  // there, development keys are tolerated because sign-in is not ready. Here, Clerk's sign-in is
  // not reachable at all — proxy.ts turns /auth away whether or not a session exists — so the
  // properties a development instance lacks are properties nothing in this deployment relies on.
  const developmentKeysPermitted = env.APP_ENV === 'staging' || codeMode;

  if (developmentKeysPermitted) {
    if (env.APP_ENV === 'staging') {
      console.warn(
        '[preflight] STAGING DEPLOYMENT — running on Clerk development keys. Sign-in is accepted from any origin and the instance is capped at 100 users. Do not put real employee or client data in this environment.'
      );
    } else {
      console.warn(
        '[preflight] Running on Clerk development keys, permitted because access-code mode makes no use of Clerk sign-in. Do not turn ACCESS_CODE_MODE off on this deployment without replacing them.'
      );
    }
  } else {
    if (env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_')) {
      problems.push({
        variable: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
        detail:
          'is a development key (pk_test_). Production needs a Clerk production instance, which needs a domain you control. Set APP_ENV=staging to run this as a labelled staging deployment instead'
      });
    }
    if (env.CLERK_SECRET_KEY?.startsWith('sk_test_')) {
      problems.push({
        variable: 'CLERK_SECRET_KEY',
        detail: 'is a development key (sk_test_). Production needs a Clerk production instance'
      });
    }
  }

  // The Hub holds no provider key of its own for SYRIX AI (docs/forma-ai-architecture.md §2); it
  // pairs with a gateway. Without one the assistant is the only thing that stops working, so
  // this is not worth refusing to boot over — but it should never be a surprise.
  if (!env.FORMA_AI_GATEWAY_URL || !env.FORMA_AI_GATEWAY_TOKEN) {
    console.warn(
      '[preflight] SYRIX AI is not paired (FORMA_AI_GATEWAY_URL/FORMA_AI_GATEWAY_TOKEN). The assistant will be unavailable; everything else runs.'
    );
  }

  // Warned rather than refused — see the note on OPTIONAL_STORAGE. Partial configuration is
  // called out separately from none at all, because three of four values set is a typo or a
  // half-finished setup, not a deliberate choice to run without file storage.
  const storageSet = OPTIONAL_STORAGE.filter((name) => env[name]);
  if (storageSet.length === 0) {
    console.warn(
      '[preflight] No object storage configured (R2_*). File attachments and document upload/download will report as unavailable; the rest of the Hub runs normally.'
    );
  } else if (storageSet.length < OPTIONAL_STORAGE.length) {
    const missing = OPTIONAL_STORAGE.filter((name) => !env[name]);
    problems.push({
      variable: missing.join(', '),
      detail: 'object storage is partly configured — set all four R2_* values or none'
    });
  }

  return problems;
}

/** Throws if this process should not be serving. Called once, at boot, from instrumentation.ts. */
export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'development') return;

  const problems = collectConfigProblems(env);
  if (problems.length === 0) return;

  const lines = problems.map((p) => `  - ${p.variable}: ${p.detail}`).join('\n');
  throw new Error(
    `SYRIX Forma cannot start — ${problems.length} configuration problem(s):\n${lines}\n\nSee .env.example for what each one is.`
  );
}
