# Finance Tracker

A personal finance dashboard: accounts, transactions, monthly budgets, and
recurring payments. Next.js 16 (App Router) over PostgreSQL, deployed with
Docker Compose.

Everything resolves in **America/New_York**, regardless of the host's timezone
or the viewer's — see [`src/lib/dates.ts`](src/lib/dates.ts).

## Requirements

- Node 20+ and npm (local development)
- PostgreSQL 16+ (18 in production; the schema uses `gen_random_uuid()`)
- Docker with Compose (deployment)

## Running it locally

```bash
cd finance-app
npm install
```

Start a database. Any Postgres works; a throwaway container is easiest:

```bash
docker run -d --name finance-local -e POSTGRES_USER=finance -e POSTGRES_PASSWORD=localdev -e POSTGRES_DB=finance -e TZ=America/New_York -p 55432:5432 postgres:18-alpine
```

Create the schema:

```bash
docker exec -i finance-local psql -U finance -d finance < db/schema.sql
```

Point the app at it:

```bash
cp .env.example .env.local
# then set DATABASE_URL=postgresql://finance:localdev@localhost:55432/finance
```

Configure Google sign-in (see [Authentication](#authentication) for creating
the OAuth client; add `http://localhost:3000/api/auth/google/callback` as one of
its redirect URIs, and answer `http://localhost:3000` for the URL):

```bash
npm run auth:setup
```

```bash
npm run dev
```

The dashboard is at <http://localhost:3000>.

> **PowerShell:** use `docker.exe`, not `docker`. On some Windows installs a
> zero-byte extensionless file at `C:\Windows\System32\docker` shadows the real
> executable, and PowerShell refuses to run it in a pipeline
> ("Cannot run a document in the middle of a pipeline"). Deleting that file from
> an elevated prompt fixes it permanently. Piping a file into `docker exec -i`
> is also unreliable through PowerShell's object pipeline; use
> `cmd /c "docker exec -i ... < file"`.

### No seed data

There is no seed step. The first time someone signs in, they get their own 12
`monthly_budgets` rows (at 0) and an opening snapshot for the current month
([`src/lib/users.ts`](src/lib/users.ts)), which is everything the dashboard
and the monthly job need. `db/seed.sql`, which did this once for the whole
database, is gone.

## Deploying

```bash
cp .env.example .env                 # fill in POSTGRES_PASSWORD and DATABASE_URL
npm run auth:setup -- --env .env     # Google sign-in settings
docker compose up -d --build
```

First run only, to create the schema:

```bash
docker compose exec -T postgres psql -U finance -d finance < db/schema.sql
```

Two services by default, `app` and `worker`, plus an optional `postgres` behind
the `with-db` profile. **The `worker` service is what runs the scheduled jobs** —
the Dockerfile's `CMD` only starts the web app.

> An earlier version of this file claimed the cron jobs had never run in
> production. That was wrong: the NAS has been running an `app` + `worker` pair
> since May 2026, and the worker's logs show the daily recurring-payment job
> firing at midnight ET every day. The claim came from the repo having no
> compose file, not from checking the deployment.

The database is normally **external to this file** — on the NAS it is the
standalone `finance_app_db` container, which predates this compose project and
holds the real data. That is why `postgres` is behind a profile: defining it
unconditionally would start a second, empty database beside the real one.

Confirm the worker with:

```bash
docker compose logs worker   # expect "Worker started... (bundled scripts)"
docker compose ps            # app should reach (healthy)
```

### The image

Multi-stage: `deps` runs `npm ci`, `builder` compiles the Next app and bundles
the worker, and only the standalone server and its traced dependencies reach
the runtime stage. 1.61 GB down to 272 MB.

The runtime stage has no npm scripts, no TypeScript sources, no tsconfig and no
`tsx`. The worker and the two cron jobs are bundled into `dist/` by
[`build-scripts.mjs`](build-scripts.mjs), so to run a job by hand in the
container:

```bash
docker compose exec worker node dist/scripts/process-recurring-payments.mjs
```

`node-cron` is copied in rather than bundled — it resolves a `daemon.js` off
disk relative to `__dirname`.

It runs as the unprivileged `node` user, and `HEALTHCHECK` hits `/api/health`,
which round-trips the database, so an app that is up but cannot reach Postgres
reports unhealthy rather than ok.

### Migrating an existing database

An existing deployment predating `db/schema.sql` needs
[`db/migrations/0001_integrity.sql`](db/migrations/0001_integrity.sql) before
the current code will run: it adds `accounts.archived`, makes `accounts.max`
`NOT NULL DEFAULT 0`, adds the snapshot's `(month, year)` unique constraint, and
adds the recurring-payment idempotency columns.

Run the pre-flight queries in its header first — duplicate `(month, year)`
snapshot rows are the one thing that will block it. The whole file is one
transaction and is safe to re-run.

**Apply it to a restored copy of a dump before the live database.**

A database from before Google sign-in also needs
[`db/migrations/0002_multi_user.sql`](db/migrations/0002_multi_user.sql), which
adds `users` and a `user_id` on every table, and hands every existing row to
one owner. Put the owner's Google email on the line marked `>>>` (it refuses to
run with the placeholder), then run it — it works pasted into pgAdmin's Query
Tool as well as through `psql`. That owner's first Google sign-in links to the
existing data by verified email. **Deploy the new code right after**: the old
code cannot write to the migrated schema.

## Authentication

Sign-in is with Google, and each person who signs in has their own separate
tracker: their own accounts, transactions, budgets, recurring payments and
monthly snapshots. Nobody can see or change anyone else's.

### Setting up Google

1. In the [Google Cloud console](https://console.cloud.google.com/), create or
   pick a project, then **APIs & Services → OAuth consent screen**. Choose
   *External*, fill in the app name and your email, and add the scopes
   `openid`, `email` and `profile` (all non-sensitive, so no Google review).
   While the app is in *Testing*, only the test users you list there can sign
   in — add everyone who will use it.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**,
   type *Web application*. Under *Authorized redirect URIs* add, exactly,
   `<AUTH_URL>/api/auth/google/callback` — one per place you run it, e.g.
   `http://localhost:3000/api/auth/google/callback` for development.
3. Put the client ID and secret into the env file:

```bash
npm run auth:setup                   # writes .env.local (local development)
npm run auth:setup -- --env .env     # writes .env (docker compose)
```

It prompts for the client ID, client secret (not echoed), `AUTH_URL` and
`AUTH_ALLOWED_EMAILS`, generates `AUTH_SECRET` if there is none, and removes the
old `AUTH_PASSWORD_HASH`. Re-running it offers the current values as defaults.

**Google needs a real https URL.** Redirect URIs must be `https` and use a
domain name — `http://100.x.y.z:3000` is refused. The exception is
`http://localhost`. On a Tailscale network, `tailscale serve --bg 3000` on the
NAS publishes the app at `https://<machine>.<tailnet>.ts.net` with a real
certificate, and that is what `AUTH_URL` should be.

> **Do not redirect this into a file** (`npm run auth:setup >> .env`). Two
> things go wrong and both are invisible until sign-in fails: `npm run` prints
> its own `> package@version script` banner on stdout, which lands in the file
> as if it were a variable; and PowerShell's `>>` writes UTF-16LE with a BOM,
> which no dotenv parser can read. The script writes the file itself for
> exactly this reason, and repairs a file already damaged this way.

**Which file matters.** Next gives `.env.local` priority over `.env`, so a value
in `.env.local` wins for `npm run dev` even if `.env` has a different one.
Compose reads `.env` only.

### Who can sign in

`AUTH_ALLOWED_EMAILS` is required: a comma-separated list of Google account
emails, or `*` for any Google account at all. There is no default, because
"unset" must not mean "everyone with a Google account". Someone not on the list
is refused before anything is written for them.

A new person on the list gets an empty tracker the first time they sign in.
Remove someone and restart, and their session stops working on the next
request — the email is in the session and checked every time.

### How it works

- [`src/app/api/auth/google/route.ts`](src/app/api/auth/google/route.ts) sends
  the browser to Google with a random `state`, `nonce` and PKCE challenge, kept
  in a signed ten-minute cookie.
- [`src/app/api/auth/google/callback/route.ts`](src/app/api/auth/google/callback/route.ts)
  checks `state`, exchanges the code (with the PKCE verifier and client secret)
  for an ID token, checks its issuer, audience, expiry, nonce and
  `email_verified`, applies the allowlist, and finds or creates the user
  ([`src/lib/users.ts`](src/lib/users.ts)). Users are matched on Google's
  stable `sub`, not on email.
- The session is a signed cookie holding the user's id, email and an expiry
  (30 days, HttpOnly, SameSite=Lax, Secure when `AUTH_URL` is https). The
  middleware checks it on every request, and so does every route handler
  ([`src/lib/session.ts`](src/lib/session.ts)), which then filters every query
  by that user.
- The database backs this up: `transactions` and `recurring_payments`
  reference `accounts(id, user_id)`, so a row can only point at an account its
  own user owns, even if a route forgot to check.

There is no sessions table and therefore no per-session revocation: **rotate
`AUTH_SECRET` and restart to sign out everyone.**

**Auth is fail-closed.** With `AUTH_SECRET` or `AUTH_ALLOWED_EMAILS` unset the
app answers 503 to everything rather than serving data — a security control
that quietly switches itself off when misconfigured is worse than none, because
you cannot tell from the outside. Compose refuses to start without any of them.

| Variable | |
|---|---|
| `AUTH_SECRET` | signs session cookies; rotating it invalidates all sessions |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | the OAuth client, from the Google Cloud console |
| `AUTH_URL` | the public origin; the redirect URI is this plus `/api/auth/google/callback` |
| `AUTH_ALLOWED_EMAILS` | who may sign in: emails, comma-separated, or `*` |
| `AUTH_COOKIE_SECURE` | overrides the Secure flag, which otherwise follows `AUTH_URL` |

`/api/health` is deliberately public so the container healthcheck works before
anyone logs in; it returns only `{"status":"ok"}`.

## Layout

| Path | What it is |
|---|---|
| `src/app/page.tsx` | the dashboard |
| `src/app/api/*` | route handlers; every mutating one runs in a transaction |
| `src/lib/` | the shared vocabulary: `db`, `accounting`, `dates`, `categories`, `format`, `api`, and sign-in: `auth`, `google`, `session`, `users` |
| `src/types/api.ts` | the request/response contract, shared by client and server |
| `scripts/` | the two scheduled jobs — see [scripts/README.md](scripts/README.md) |
| `worker.mjs` | the scheduler; runs jobs through one queue so they cannot race |
| `db/` | `schema.sql` and `migrations/` |
| `tests/` | see below |

Two things about the data model that the column names do not tell you:

- **`accounts.max` means two different things.** On a credit account it is the
  credit limit. On a bank account it is cumulative income received. Both are
  displayed, differently, by `AccountCard`.
- **`monthly_budgets` has no `year`.** It is 12 rows per user, reused every
  year. That is deliberate.

## Tests

```bash
npm test           # everything
npm run test:unit  # tier 1 only, no database needed
npm run verify     # lint + typecheck + test
```

**Tier 1** (`tests/unit/`) is pure functions: the balance formula over every
category and account type, the day-of-month clamp, the month rollover, the
timezone handling. No database, runs in under a second.

**Tier 2** (`tests/integration/`) runs against a real Postgres. It creates a
throwaway database from `db/schema.sql`, derived from `DATABASE_URL` by
appending `_test` to the database name, and drops and rebuilds it on every run.
It refuses to touch a database whose name does not end in `_test`, so pointing
`DATABASE_URL` at real data cannot destroy it. Set `TEST_DATABASE_URL` to
override.

These exist to protect specific bugs, each named in the file it lives in: the
transaction routes writing one row and not the other, the recurring job
double-charging on a re-run, the snapshot job subtracting spending twice,
account deletion orphaning history — and, in `user-isolation.test.ts`, one user
reading or writing another's data through any route.

## Scripts

| Command | |
|---|---|
| `npm run dev` | development server |
| `npm run build` / `npm start` | production build and serve |
| `npm run lint` | eslint |
| `npm run typecheck` | `tsc --noEmit`, covering `scripts/` and `tests/` too |
| `npm test` | vitest |
| `npm run verify` | lint + typecheck + test |
| `npm run auth:setup` | write the Google sign-in settings to an env file |
| `npm run worker` | the scheduler, in the foreground |
| `npm run process-recurring` | apply today's recurring payments |
| `npm run process-monthly-snapshot` | roll the ledger to a new month |
