# Multi-stage build. The previous single-stage image ran `npm install` (dev
# dependencies included), copied the whole working tree, and shipped all of it:
# typescript, eslint, tailwind, vitest, the .ts sources and the full .next
# build cache, for roughly 1.2 GB. Only the compiled server and its traced
# dependencies reach the runtime stage now.

# ---------------------------------------------------------------------------
# deps — install once, cached until package-lock.json changes
# ---------------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

# `npm ci` rather than `npm install`: it installs exactly the lockfile and
# fails if package.json and the lockfile disagree, so a build cannot silently
# resolve a different dependency tree than the one that was tested.
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# builder — compile the Next app and bundle the cron scripts
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
# Set before the build so Next compiles in production mode.
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# next.config.ts sets output: "standalone", so this emits .next/standalone with
# a minimal traced node_modules.
RUN npm run build

# Bundles worker.mjs and the two scripts into dist/, inlining everything under
# src/lib that they use. This is what lets the runtime image omit tsx, the
# TypeScript sources and tsconfig entirely. See build-scripts.mjs.
RUN npm run build:scripts

# ---------------------------------------------------------------------------
# runner — what actually ships
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache tzdata
ENV TZ=America/New_York
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# node:20-alpine already provides an unprivileged `node` user (uid 1000).
# The previous image ran everything as root.
USER node

# The standalone output is self-contained: server.js plus the node_modules
# Next's tracing proved reachable. `public` and `.next/static` are not traced
# and have to be copied alongside it.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# The worker lives beside the standalone node_modules, so Node resolves `pg`
# by walking up from dist/. Everything else it needs is bundled in, except:
COPY --from=builder --chown=node:node /app/dist ./dist

# node-cron, which cannot be bundled — it resolves a daemon.js off disk
# relative to __dirname. Next's tracing does not include it either, since no
# route imports it. It has no dependencies of its own (523K).
COPY --from=builder --chown=node:node /app/node_modules/node-cron ./node_modules/node-cron

EXPOSE 3000

# Uses the app's own /api/health, which round-trips the database — so an app
# that is up but cannot reach Postgres reports unhealthy rather than ok.
# Node's global fetch avoids adding curl or wget to the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The standalone server, not `npm start` — there is no npm script here, and
# `next start` does not work against standalone output.
CMD ["node", "server.js"]
