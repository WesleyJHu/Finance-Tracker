--
-- 0001_integrity — bring an existing database up to db/schema.sql
--
-- Safe to run more than once. Runs live: no table rewrites large enough to
-- matter at this data volume, and no exclusive lock held for long.
--
--     psql "$DATABASE_URL" -f db/migrations/0001_integrity.sql
--
-- RUN THE PRE-FLIGHT FIRST (below, separately). Duplicate (month, year)
-- snapshot rows are the only thing that can make this migration fail, and it
-- fails after some statements have already applied unless you clear them.
--
-- ===========================================================================
-- PRE-FLIGHT — run this on its own and confirm it returns zero rows
-- ===========================================================================
--
--   SELECT month, year, count(*), array_agg(id) AS ids
--   FROM monthly_balance_snapshot
--   GROUP BY month, year
--   HAVING count(*) > 1;
--
-- If it returns rows, decide which id to keep for each period and delete the
-- others before continuing. There was no unique constraint until now, so
-- duplicates were silently possible (the dashboard just read the first).
--
-- Two more that should already be empty, but confirm:
--
--   SELECT count(*) FROM transactions t
--   LEFT JOIN accounts a ON a.id = t.account_id WHERE a.id IS NULL;
--
--   SELECT count(*) FROM monthly_balance_snapshot
--   WHERE month <> trunc(month) OR year <> trunc(year);
--
-- ===========================================================================

BEGIN;


-- ---------------------------------------------------------------------------
-- accounts: soft delete, and make `max` non-null
-- ---------------------------------------------------------------------------
-- `max` was nullable with no default, so `SET max = max + $1` in the API
-- evaluated to NULL and silently destroyed the column for any account whose
-- max had never been set.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

UPDATE accounts SET max = 0 WHERE max IS NULL;

ALTER TABLE accounts ALTER COLUMN max SET DEFAULT 0;
ALTER TABLE accounts ALTER COLUMN max SET NOT NULL;

COMMENT ON COLUMN accounts.max IS
    'Credit limit for credit accounts; cumulative income for all others.';
COMMENT ON COLUMN accounts.archived IS
    'Soft delete. The app never hard-deletes an account, so transaction history is never orphaned.';


-- ---------------------------------------------------------------------------
-- monthly_balance_snapshot: integer periods, one row per period
-- ---------------------------------------------------------------------------
-- month and year were numeric(10,2) — months stored as decimals — and the
-- primary key was on `id` alone, so two rows for the same month were possible
-- and the dashboard just took the first.

ALTER TABLE monthly_balance_snapshot ALTER COLUMN month TYPE smallint USING month::smallint;
ALTER TABLE monthly_balance_snapshot ALTER COLUMN year  TYPE smallint USING year::smallint;

DO $$
BEGIN
    ALTER TABLE monthly_balance_snapshot
        ADD CONSTRAINT monthly_balance_snapshot_period_uniq UNIQUE (month, year);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN
    RAISE NOTICE 'monthly_balance_snapshot_period_uniq already exists, skipping';
END $$;

DO $$
BEGIN
    ALTER TABLE monthly_balance_snapshot
        ADD CONSTRAINT monthly_balance_snapshot_month_check CHECK (month >= 1 AND month <= 12) NOT VALID;
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'monthly_balance_snapshot_month_check already exists, skipping';
END $$;

ALTER TABLE monthly_balance_snapshot VALIDATE CONSTRAINT monthly_balance_snapshot_month_check;


-- ---------------------------------------------------------------------------
-- transactions: a satisfiable foreign key
-- ---------------------------------------------------------------------------
-- The existing FK was ON DELETE SET NULL on a NOT NULL column, so deleting an
-- account that had any transaction always raised a not-null violation —
-- account deletion was entirely broken. The app now archives instead of
-- deleting; RESTRICT is the backstop that keeps it that way.

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_account_id_fkey;
ALTER TABLE transactions
    ADD CONSTRAINT transactions_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE transactions VALIDATE CONSTRAINT transactions_account_id_fkey;


-- ---------------------------------------------------------------------------
-- transactions: idempotency for the recurring-payments job
-- ---------------------------------------------------------------------------
-- There was no record of what had already been applied, so a container
-- restart, a manual run, or a double cron fire duplicated the transaction and
-- double-debited the account. The partial unique index below lets the job
-- insert with ON CONFLICT DO NOTHING and skip the balance update when no row
-- comes back — atomic, rather than check-then-act.
--
-- recurring_payments.id is integer, not uuid, so this column is integer.

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS recurring_payment_id integer,
    ADD COLUMN IF NOT EXISTS period_year smallint,
    ADD COLUMN IF NOT EXISTS period_month smallint;

DO $$
BEGIN
    ALTER TABLE transactions
        ADD CONSTRAINT transactions_recurring_payment_id_fkey
        FOREIGN KEY (recurring_payment_id) REFERENCES recurring_payments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'transactions_recurring_payment_id_fkey already exists, skipping';
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_recurring_period_uniq
    ON transactions (recurring_payment_id, period_year, period_month)
    WHERE recurring_payment_id IS NOT NULL;

COMMENT ON COLUMN transactions.recurring_payment_id IS
    'Set only on rows generated by scripts/process-recurring-payments.ts.';
COMMENT ON COLUMN transactions.period_month IS
    'The ET month this recurring charge was applied for. With period_year and recurring_payment_id, makes the job idempotent.';


-- ---------------------------------------------------------------------------
-- Indexes and redundant constraints
-- ---------------------------------------------------------------------------
-- account_id had no index despite being the FK and the filter for
-- GET /api/transactions?account=...

CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions (account_id);

-- monthly_budgets had both a PRIMARY KEY and a UNIQUE constraint on `month`,
-- i.e. two identical indexes.
ALTER TABLE monthly_budgets DROP CONSTRAINT IF EXISTS "Unique Month";

-- The CHECK on monthly_budgets.month was created NOT VALID and never validated.
ALTER TABLE monthly_budgets VALIDATE CONSTRAINT "Month value";


COMMIT;
