# Scheduled jobs

Two one-shot scripts, both scheduled by [`worker.mjs`](../worker.mjs), which runs
as the `worker` service in [`docker-compose.yml`](../docker-compose.yml).

You do not need cron, Task Scheduler, or PM2. **Do not run these under PM2** —
it restarts a process when it exits, and these exit on purpose, so
`pm2 start npm -- run process-monthly-snapshot` produces an endless loop of
monthly snapshots.

Both are safe to run by hand at any time, and safe to run twice.

| Script | Schedule | npm script |
|---|---|---|
| `process-recurring-payments.ts` | daily, midnight ET | `npm run process-recurring` |
| `process-monthly-balance-snapshot.ts` | 1st of the month, midnight ET | `npm run process-monthly-snapshot` |

`worker.mjs` runs jobs through a single queue rather than concurrently. Both
fire at midnight on the 1st, and they both write `accounts.balance`; running
them at the same time left the result dependent on which finished first.

## process-recurring-payments

Applies every recurring payment whose day of the month is today.

- The due day is **clamped to the length of the month**, so a payment set to the
  31st fires on the 28th of February rather than never firing at all. Each
  payment fires exactly once per month, always.
- Idempotent by database constraint, not by application logic. The insert is
  `ON CONFLICT (recurring_payment_id, period_year, period_month) DO NOTHING`,
  and the balance update is skipped when nothing was inserted — so a container
  restart, a double cron fire, or a manual re-run cannot double-charge.
- Dates are the ET calendar date. Using a UTC instant put any run after 20:00 ET
  on tomorrow's date, which lands in the wrong month on the 30th and 31st.
- `recurring_payments.category` is `varchar` in Title Case;
  `transactions.category` is the lowercase enum `public."Category"`. The script
  lowercases on the way across. That conversion is load-bearing — without it the
  insert throws.
- Exits non-zero on failure, so the worker can see it.

## process-monthly-balance-snapshot

Rolls the ledger over at the start of a new month, in one transaction:

1. Closes out the previous month — writes its `ending_balance` as
   `starting_balance + income - expenses`.
2. Opens the current month — writes `starting_balance` as the previous month's
   ending balance **plus this month's `base_budget`**. `src/app/page.tsx` depends
   on that definition and must not add the budget again. See the header of
   [`db/schema.sql`](../db/schema.sql).
3. Zeroes the accounts that reset monthly — anything whose type contains
   `credit` or `brokerage`, matched by substring so an account typed
   "Credit Card" is caught.

It deliberately does **not** re-derive balances from transactions. The API
already decrements `accounts.balance` as each transaction is created, so the
old `balance - spent` here subtracted the same spending twice. Non-credit
balances now carry forward month to month, like a real bank account — you will
notice this on the 1st, when they no longer drop.

The first ever run has no previous snapshot to read; it treats that month's
starting balance as 0 and says so. It requires a `monthly_budgets` row for the
current month, and fails with a clear message naming `db/seed.sql` if there
isn't one.

## Running by hand

```bash
cd finance-app
npm run process-recurring
npm run process-monthly-snapshot
```

Or inside the running stack:

```bash
docker compose exec worker npm run process-recurring
```

Both read `DATABASE_URL` from the environment, falling back to
`finance-app/.env.local`. A real environment variable always wins, so compose
is unaffected.

## Tests

`tests/integration/recurring-payments.test.ts` and
`tests/integration/monthly-snapshot.test.ts` run both scripts as real
subprocesses against a throwaway database, and assert the idempotency
guarantees above. See the root [README](../README.md#tests).
