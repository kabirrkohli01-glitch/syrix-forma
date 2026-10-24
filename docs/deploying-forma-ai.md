# Running SYRIX AI somewhere other than a developer's machine

Everything SYRIX AI depends on already runs as a hosted service — the models
behind the gateway, Postgres, Redis, object storage and authentication. The only
part that has ever run locally is the Next.js application itself. This document
records what a host has to provide so that moving it is a deployment and not a
rewrite.

Nothing here is a recommendation of a particular host. It is the list of things
that must be true wherever it ends up.

## Check the host before trusting it

```
npx tsx --require ./scripts/preload-env.cjs scripts/ai-probe.ts env
```

Run this **on the host**, not locally. It prints which environment variables are
set — never their values — and whether each outbound service actually answers
from that network. A container that cannot reach `data.sec.gov` produces answers
that quietly lack a lane rather than an error anybody would notice, and this is
the only place that difference is visible.

## Environment

| Variable | Needed for | If it is missing |
|---|---|---|
| `FORMA_AI_GATEWAY_URL` | Where the assistant reaches its models. | Nothing answers. Every turn fails. |
| `FORMA_AI_GATEWAY_TOKEN` | This deployment's revocable device token, issued by `scripts/pair-gateway.ts`. | Every turn fails on authentication. |
| `FORMA_AI_GATEWAY_DEVICE` | Which paired device this is. | As above. |
| `DATABASE_URL` | Hub records, for the routes that read them, and per-person AI settings. | Research still works; anything about tasks, calendar, clients or people does not. |
| `CLERK_SECRET_KEY` | Establishing who is asking. | No Hub access at all — the routes that need an identity refuse rather than guessing one. |
| `FORMA_AI_BROWSER` | Optional. Set to `on` **only** where a Chromium is genuinely installed. | The browser lane is skipped and recorded as unavailable. See below. |
| `SEARXNG_URL` | Optional. A self-hosted search instance, if one exists. | That lane is skipped. |

Pair a new deployment with its own device token rather than copying an existing
one. The token is revocable per device, which is the entire point of it, and a
shared token cannot be revoked for one host without breaking the others.

## The browser lane is off unless you turn it on

`playwright-core` drives a Chromium that is already installed; it does not ship
one. That is true of a developer's machine and false of an ordinary container, so
a default of "on" would make the assistant's behaviour depend on which machine
happened to serve the request.

Very little is lost by leaving it off. The lane only ever ran as a fallback for
search engines that serve a challenge page to anything that is not a person, and
a challenge served over HTTP is served to a headless browser too — which is why
it is recorded as blocked rather than worked around. With it off, the lane is
reported as unavailable, which is a different statement from "the web had
nothing".

Turn it on where a Chromium exists and the host has the memory for it.

## Outbound hosts

All keyless, all free, none requiring an account. A host that blocks egress needs
these allowed, or the corresponding lane silently stops contributing:

- `www.gov.uk`, `assets.publishing.service.gov.uk` — the primary immigration lane
- `www.legislation.gov.uk` — primary legislation
- `en.wikipedia.org` — general background
- `feeds.bbci.co.uk`, `www.theguardian.com`, `feeds.arstechnica.com`,
  `www.theverge.com`, `techcrunch.com`, `www.technologyreview.com`,
  `export.arxiv.org` — the news lane
- `www.gov.uk/search/news-and-communications.atom` and the Home Office feed —
  official announcements
- `www.sec.gov`, `data.sec.gov` — filed company figures. The SEC asks callers to
  identify themselves and a contact address; `lib/ai/research/markets.ts` does,
  and that identifier should be kept accurate.
- `query1.finance.yahoo.com` — quotes

## What the server still does not store

Deploying changes nothing about this, and it is worth restating because it is the
claim the interface makes to its users:

- No transcript is written. The conversation is held by the browser and posted
  with each turn; nothing reaches Postgres, Redis, logs or Sentry.
- An action proposal is held server-side for a few minutes and nothing else is.
  An approval that round-trips its own payload through the browser is not an
  approval control.
- Attachments are decoded, read, used and dropped within the request.

Per-person separation comes from the session, not from the deployment: settings
actions take no employee id at all, proposals are keyed to the employee who
created them, and Hub reads run through each feature's own scope rules. One
person's conversation cannot reach another's on the same host — see
`tests/forma-ai/isolation.test.ts`.
