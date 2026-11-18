--
-- 0002_multi_user — per-user data, for Google sign-in
--
-- Adds a `users` table and a `user_id` column to every data table, and hands
-- every existing row to one owner: the Google account you name below. Your
-- first Google sign-in with that address links to this user (by verified
-- email) and you see exactly the data you see today.
--
-- Requires 0001_integrity.sql. Runs as one transaction, so it either applies
-- completely or not at all. Safe to re-run: a second run changes nothing.
--
-- ===========================================================================
-- BEFORE RUNNING
-- ===========================================================================
--
--   1. Back up the database. This re-keys two tables' primary/unique keys.
--
--   2. Put the Google account that should own the existing data on the line
--      marked >>> below. The script refuses to run with the placeholder.
--      It is not stored anywhere but the users table.
--
--   3. Deploy the new app version straight after. The old version cannot
--      write to the migrated schema: it does not supply user_id, and its
--      upserts name the old (month) and (month, year) conflict keys.
--
-- Works in pgAdmin's Query Tool (paste, edit the email, F5) and in psql:
--
--     psql "$DATABASE_URL" -f db/migrations/0002_multi_user.sql
--
-- ===========================================================================

BEGIN;

CREATE TEMP TABLE migration_owner (email text NOT NULL) ON COMMIT DROP;

-- >>> The owner's Google account email: <<<
INSERT INTO migration_owner (email) VALUES ('REPLACE_WITH_YOUR_GOOGLE_EMAIL');

DO $$
DECLARE
    owner_email text := (SELECT email FROM migration_owner);
BEGIN
    IF owner_email = 'REPLACE_WITH_YOUR_GOOGLE_EMAIL' OR owner_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'Set the owner email on the line marked >>> before running this migration (got "%")', owner_email;
    END IF;
END $$;


-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
-- google_sub stays NULL until the owner's first sign-in, which matches on
-- verified email and fills it in. From then on sign-in matches on google_sub
-- only. See src/lib/users.ts.

CREATE TABLE IF NOT EXISTS users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    google_sub text,
    email text NOT NULL,
    name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login_at timestamp with time zone,
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_google_sub_key UNIQUE (google_sub),
    CONSTRAINT users_email_key UNIQUE (email),
    CONSTRAINT users_email_lowercase CHECK (email = lower(email))
);

INSERT INTO users (email)
SELECT lower(trim(email)) FROM migration_owner
ON CONFLICT (email) DO NOTHING;

-- The owner's id, for the backfills below. A temp table rather than a psql
-- variable, so this file runs unchanged in pgAdmin.
CREATE TEMP TABLE migration_owner_id ON COMMIT DROP AS
SELECT u.id FROM users u JOIN migration_owner o ON u.email = lower(trim(o.email));


-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS user_id uuid;
UPDATE accounts SET user_id = (SELECT id FROM migration_owner_id) WHERE user_id IS NULL;
ALTER TABLE accounts ALTER COLUMN user_id SET NOT NULL;

DO $$
BEGIN
    ALTER TABLE accounts
        ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'accounts_user_id_fkey already exists, skipping';
END $$;

-- The target of the composite foreign keys below. id is already the primary
-- key, so this adds no uniqueness of its own.
DO $$
BEGIN
    ALTER TABLE accounts ADD CONSTRAINT accounts_id_user_id_key UNIQUE (id, user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN
    RAISE NOTICE 'accounts_id_user_id_key already exists, skipping';
END $$;

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts (user_id);


-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------
-- Backfilled from the row's account rather than straight from the owner, so
-- the composite foreign key below is satisfied by construction.

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS user_id uuid;
UPDATE transactions t SET user_id = a.user_id
  FROM accounts a
 WHERE a.id = t.account_id AND t.user_id IS NULL;
ALTER TABLE transactions ALTER COLUMN user_id SET NOT NULL;

DO $$
BEGIN
    ALTER TABLE transactions
        ADD CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'transactions_user_id_fkey already exists, skipping';
END $$;

-- Replaces the single-column (account_id) key with (account_id, user_id), so
-- a transaction can never sit in another user's account. Same name and same
-- ON DELETE RESTRICT as before.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_account_id_fkey;
ALTER TABLE transactions
    ADD CONSTRAINT transactions_account_id_fkey
    FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_transactions_user_id_date ON transactions (user_id, date);


-- ---------------------------------------------------------------------------
-- recurring_payments
-- ---------------------------------------------------------------------------
-- account_id is nullable here, so a payment with no account takes the owner
-- directly.

ALTER TABLE recurring_payments ADD COLUMN IF NOT EXISTS user_id uuid;
UPDATE recurring_payments r SET user_id = a.user_id
  FROM accounts a
 WHERE a.id = r.account_id AND r.user_id IS NULL;
UPDATE recurring_payments SET user_id = (SELECT id FROM migration_owner_id) WHERE user_id IS NULL;
ALTER TABLE recurring_payments ALTER COLUMN user_id SET NOT NULL;

DO $$
BEGIN
    ALTER TABLE recurring_payments
        ADD CONSTRAINT recurring_payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'recurring_payments_user_id_fkey already exists, skipping';
END $$;

ALTER TABLE recurring_payments DROP CONSTRAINT IF EXISTS recurring_payments_account_id_fkey;
ALTER TABLE recurring_payments
    ADD CONSTRAINT recurring_payments_account_id_fkey
    FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id);

CREATE INDEX IF NOT EXISTS idx_recurring_payments_user_id ON recurring_payments (user_id);


-- ---------------------------------------------------------------------------
-- monthly_budgets: (month) -> (user_id, month)
-- ---------------------------------------------------------------------------

ALTER TABLE monthly_budgets ADD COLUMN IF NOT EXISTS user_id uuid;
UPDATE monthly_budgets SET user_id = (SELECT id FROM migration_owner_id) WHERE user_id IS NULL;
ALTER TABLE monthly_budgets ALTER COLUMN user_id SET NOT NULL;

DO $$
BEGIN
    ALTER TABLE monthly_budgets
        ADD CONSTRAINT monthly_budgets_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'monthly_budgets_user_id_fkey already exists, skipping';
END $$;

-- Same constraint name, new columns. Nothing references this key.
ALTER TABLE monthly_budgets DROP CONSTRAINT IF EXISTS "Monthly_budgets_pkey";
ALTER TABLE monthly_budgets ADD CONSTRAINT "Monthly_budgets_pkey" PRIMARY KEY (user_id, month);


-- ---------------------------------------------------------------------------
-- monthly_balance_snapshot: (month, year) -> (user_id, month, year)
-- ---------------------------------------------------------------------------

ALTER TABLE monthly_balance_snapshot ADD COLUMN IF NOT EXISTS user_id uuid;
UPDATE monthly_balance_snapshot SET user_id = (SELECT id FROM migration_owner_id) WHERE user_id IS NULL;
ALTER TABLE monthly_balance_snapshot ALTER COLUMN user_id SET NOT NULL;

DO $$
BEGIN
    ALTER TABLE monthly_balance_snapshot
        ADD CONSTRAINT monthly_balance_snapshot_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'monthly_balance_snapshot_user_id_fkey already exists, skipping';
END $$;

ALTER TABLE monthly_balance_snapshot DROP CONSTRAINT IF EXISTS monthly_balance_snapshot_period_uniq;
ALTER TABLE monthly_balance_snapshot
    ADD CONSTRAINT monthly_balance_snapshot_period_uniq UNIQUE (user_id, month, year);


-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    owner record;
BEGIN
    SELECT u.id, u.email INTO owner FROM users u JOIN migration_owner_id o ON o.id = u.id;
    RAISE NOTICE 'Owner % (%): % accounts, % transactions, % recurring payments, % budgets, % snapshots',
        owner.email, owner.id,
        (SELECT count(*) FROM accounts WHERE user_id = owner.id),
        (SELECT count(*) FROM transactions WHERE user_id = owner.id),
        (SELECT count(*) FROM recurring_payments WHERE user_id = owner.id),
        (SELECT count(*) FROM monthly_budgets WHERE user_id = owner.id),
        (SELECT count(*) FROM monthly_balance_snapshot WHERE user_id = owner.id);
END $$;

COMMIT;
