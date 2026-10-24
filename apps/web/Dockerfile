# SYRIX Forma — production image.
#
# One image, two processes. `node server.js` serves the app; `npm run worker` runs the BullMQ
# worker that drives automations, task reminders and the integration reconciliation passes.
# They are separate containers off the same build (see compose.yml) because a BullMQ Worker is a
# long-running process and nothing about it fits a request/response lifecycle — running it inside
# the web container would tie the queue's health to a request handler's.
#
# Previously this file installed with `bun install --frozen-lockfile` against `bun.lock`. This
# repo has never had a bun.lock — it locks with npm — so that install could only ever fail on a
# clean checkout. It uses the lockfile that actually exists.

ARG NODE_VERSION=22-slim

# ============================================
# Stage 1: Install dependencies
# ============================================
FROM node:${NODE_VERSION} AS dependencies

WORKDIR /app

# Only the manifests, so this layer is reused on every build that doesn't change dependencies.
COPY package.json package-lock.json ./

# `npm ci` rather than `npm install`: it installs exactly the locked tree and fails if the
# lockfile and package.json disagree, which is the property that makes a build reproducible.
RUN npm ci

# ============================================
# Stage 2: Build the Next.js application
# ============================================
FROM node:${NODE_VERSION} AS builder

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so they have to be
# present now rather than at run time. The Clerk publishable key is not a secret — it ships to
# every browser by design — but it does have to be the right one: it encodes the Clerk host the
# Content-Security-Policy is built from (lib/security/headers.ts), so building with a development
# key and running against a production instance yields a policy that blocks sign-in.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL=/auth/sign-in
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL=/auth/sign-up
ARG NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard
ARG NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard
ARG NEXT_PUBLIC_SENTRY_DISABLED=true

ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_CLERK_SIGN_IN_URL=${NEXT_PUBLIC_CLERK_SIGN_IN_URL}
ENV NEXT_PUBLIC_CLERK_SIGN_UP_URL=${NEXT_PUBLIC_CLERK_SIGN_UP_URL}
ENV NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=${NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL}
ENV NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=${NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL}
ENV NEXT_PUBLIC_SENTRY_DISABLED=${NEXT_PUBLIC_SENTRY_DISABLED}

ENV BUILD_STANDALONE=true

RUN npm run build

# ============================================
# Stage 3: The web server
# ============================================
FROM node:${NODE_VERSION} AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder --chown=node:node /app/public ./public

# Created with the right owner up front: the prerender cache is written at run time, and the
# process below is not root.
RUN mkdir .next && chown node:node .next

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node

EXPOSE 3000

# No published ports in compose: the only route in is the Cloudflare Tunnel, which connects
# outbound. Nothing on the host's network reaches this directly.
CMD ["node", "server.js"]

# ============================================
# Stage 4: The queue worker
# ============================================
#
# The full dependency tree rather than the standalone trace: the worker is started through tsx
# and imports handlers the Next.js build never traced, because nothing in a route reaches them.
FROM node:${NODE_VERSION} AS worker

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

USER node

CMD ["npm", "run", "worker"]
