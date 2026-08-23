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

Create the schema and the seed rows:

```bash
docker exec -i finance-local psql -U finance -d finance < db/schema.sql
docker exec -i finance-local psql -U finance -d finance < db/seed.sql
```

Point the app at it:

```bash
cp .env.example .env.local
# then set DATABASE_URL=postgresql://finance:localdev@localhost:55432/finance
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

### Seed data

`db/seed.sql` creates the 12 `monthly_budgets` rows and one bootstrap snapshot.
It is all `ON CONFLICT DO NOTHING`, so it is safe to re-run. **The app needs a
`monthly_budgets` row for the current month** — the snapshot job fails with a
clear message if there isn't one.

## Deploying

```bash
cp .env.example .env      # fill in POSTGRES_PASSWORD and DATABASE_URL
docker compose up -d --build
```

First run only, to create the schema:

```bash
docker compose exec -T postgres psql -U finance -d finance < db/schema.sql
docker compose exec -T postgres psql -U finance -d finance < db/seed.sql
```

Three services: `postgres` (named volume), `app`, and `worker`. **The `worker`
service is what runs the scheduled jobs** — the Dockerfile's `CMD` only starts
the web app, so before this compose file existed nothing ran `worker.mjs` and
the cron jobs almost certainly never fired in production. Confirm it with:

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

## Layout

| Path | What it is |
|---|---|
| `src/app/page.tsx` | the dashboard |
| `src/app/api/*` | route handlers; every mutating one runs in a transaction |
| `src/lib/` | the shared vocabulary: `db`, `accounting`, `dates`, `categories`, `format`, `api` |
| `src/types/api.ts` | the request/response contract, shared by client and server |
| `scripts/` | the two scheduled jobs — see [scripts/README.md](scripts/README.md) |
| `worker.mjs` | the scheduler; runs jobs through one queue so they cannot race |
| `db/` | `schema.sql`, `seed.sql`, and `migrations/` |
| `tests/` | see below |

Two things about the data model that the column names do not tell you:

- **`accounts.max` means two different things.** On a credit account it is the
  credit limit. On a bank account it is cumulative income received. Both are
  displayed, differently, by `AccountCard`.
- **`monthly_budgets` has no `year`.** It is 12 rows, reused every year. That is
  deliberate.

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
double-charging on a re-run, the snapshot job subtracting spending twice, and
account deletion orphaning history.

## Scripts

| Command | |
|---|---|
| `npm run dev` | development server |
| `npm run build` / `npm start` | production build and serve |
| `npm run lint` | eslint |
| `npm run typecheck` | `tsc --noEmit`, covering `scripts/` and `tests/` too |
| `npm test` | vitest |
| `npm run verify` | lint + typecheck + test |
| `npm run worker` | the scheduler, in the foreground |
| `npm run process-recurring` | apply today's recurring payments |
| `npm run process-monthly-snapshot` | roll the ledger to a new month |
