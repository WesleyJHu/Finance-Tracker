--
-- Finance-Tracker — canonical database schema
--
-- Source: pg_dump --schema-only against the live NAS database (PostgreSQL 18.1),
-- plus the corrections in db/migrations/0001_integrity.sql and the per-user
-- re-keying in db/migrations/0002_multi_user.sql.
--
-- This file is the source of truth. To bring an existing database up to it, run
-- the migrations in db/migrations/ in order. To create a fresh database:
--
--     psql "$DATABASE_URL" -f db/schema.sql
--
-- There is no seed step: each user's 12 monthly_budgets rows and first
-- snapshot are created the first time they sign in (src/lib/users.ts).
--
-- Verified 2026-08-23 by cloning the live NAS database, applying
-- 0001_integrity.sql to the clone, and diffing against a database built from
-- this file: columns and constraints match, 31 of each, all valid.
--
-- Verified 2026-11-17 for 0002_multi_user.sql the same way, starting from the
-- previous version of this file plus sample rows: after the migration,
-- pg_dump --schema-only of both is identical (42 columns, 49 constraints,
-- all valid), and a second run of the migration changes nothing.
--
-- Naming quirk, carried deliberately: three tables were originally created
-- with capitalized names and later renamed, and Postgres keeps the original
-- constraint names through a rename. So production has "Accounts_pkey",
-- "Transactions_pkey" and "Monthly_budgets_pkey", which this file reproduces.
-- The auto-generated NOT NULL constraint names are capitalized in production
-- for the same reason ("Transactions_amount_not_null" and so on) and are NOT
-- reproduced here, because naming twenty NOT NULL constraints would obscure
-- the schema to no purpose. Nothing references them.
--
-- ---------------------------------------------------------------------------
-- Domain notes — read these before changing any money column
-- ---------------------------------------------------------------------------
--
-- monthly_balance_snapshot.starting_balance
--     DEFINED AS: the previous month's ending_balance PLUS that month's
--     base_budget. Both scripts/process-monthly-balance-snapshot.ts (which
--     writes it) and src/app/page.tsx (which reads it) depend on this exact
--     definition. The dashboard must NOT add base_budget again on top of it.
--     Consequence: the row is a derived historical record. Editing a past
--     month's budget in Settings will desynchronise that month's snapshot.
--
-- monthly_balance_snapshot.ending_balance
--     starting_balance + that month's income - that month's expenses.
--     Written at the start of the following month.
--
-- accounts.balance
--     Live and authoritative. The API adjusts it on every transaction write.
--     The monthly job does NOT re-derive it from transactions; non-credit
--     balances simply carry forward month to month.
--
-- accounts.max
--     Overloaded on purpose (pending a Phase 3 fix):
--       - credit accounts  -> the credit limit, never auto-adjusted
--       - other accounts   -> cumulative income received, incremented by the
--                             API on each Income transaction
--     "N% limit used" in the UI is therefore only meaningful for credit
--     accounts.
--
-- monthly_budgets
--     Keyed on (user_id, month), with no `year` column: each user has 12
--     reusable rows shared across every year. Intentional, not an oversight.
--
-- user_id
--     Every data table carries it, and every query filters on it. The two
--     that point at an account (transactions, recurring_payments) reference
--     accounts(id, user_id) rather than accounts(id), so the database itself
--     refuses a row whose user differs from its account's. A route that
--     forgot its ownership check gets a foreign key error, not someone
--     else's account.
--
-- "credit account" test
--     Everywhere in the codebase this is `type ILIKE '%credit%'`, never an
--     exact match, because accounts.type is free text (e.g. "Credit Card").
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

-- gen_random_uuid() is built in from PostgreSQL 13, but pgcrypto is kept for
-- portability with older servers and because the live database has it.
CREATE EXTENSION IF NOT EXISTS pgcrypto;


--
-- Name: Category
--
-- transactions.category is a closed enum, NOT free text. Adding a category
-- means an ALTER TYPE migration and a matching public/<name>.svg icon.
-- Values are lowercase; recurring_payments.category is varchar in Title Case,
-- so it must be lowercased before being inserted into transactions.
--
CREATE TYPE public."Category" AS ENUM (
    'income',
    'grocery',
    'food',
    'tech',
    'transportation',
    'entertainment',
    'bills',
    'misc'
);


--
-- Name: users
--
-- One row per person who can sign in. google_sub is Google's stable account
-- id and is what sign-in matches on; an email address can change.
--
-- google_sub is NULL only for a user created ahead of their first sign-in:
-- the owner of the pre-existing data, created by 0002_multi_user.sql. That
-- first sign-in matches on verified email and fills google_sub in, after
-- which email is never used for matching again.
--
CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    google_sub text,
    email text NOT NULL,
    name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login_at timestamp with time zone,
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_google_sub_key UNIQUE (google_sub),
    CONSTRAINT users_email_key UNIQUE (email),
    -- Stored lowercased, so the unique constraint is case-insensitive.
    CONSTRAINT users_email_lowercase CHECK (email = lower(email))
);


--
-- Name: accounts
--
CREATE TABLE public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text,
    type text,
    balance numeric(12,2) DEFAULT 0.00,
    max numeric(12,2) DEFAULT 0 NOT NULL,
    archived boolean DEFAULT false NOT NULL,
    user_id uuid NOT NULL,
    CONSTRAINT "Accounts_pkey" PRIMARY KEY (id),
    -- Adds no uniqueness (id alone is the key). It exists to be the target of
    -- the composite foreign keys from transactions and recurring_payments.
    CONSTRAINT accounts_id_user_id_key UNIQUE (id, user_id),
    CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);

CREATE INDEX idx_accounts_user_id ON public.accounts USING btree (user_id);

COMMENT ON COLUMN public.accounts.max IS
    'Credit limit for credit accounts; cumulative income for all others.';
COMMENT ON COLUMN public.accounts.archived IS
    'Soft delete. The app never hard-deletes an account, so transaction history is never orphaned.';


--
-- Name: monthly_budgets
--
CREATE TABLE public.monthly_budgets (
    month integer NOT NULL,
    base_budget numeric(10,2) DEFAULT 0 NOT NULL,
    user_id uuid NOT NULL,
    CONSTRAINT "Monthly_budgets_pkey" PRIMARY KEY (user_id, month),
    CONSTRAINT "Month value" CHECK ((month >= 1) AND (month <= 12)),
    CONSTRAINT monthly_budgets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);


--
-- Name: monthly_balance_snapshot
--
CREATE TABLE public.monthly_balance_snapshot (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    starting_balance numeric(10,2) NOT NULL,
    ending_balance numeric(10,2),
    month smallint NOT NULL,
    year smallint NOT NULL,
    user_id uuid NOT NULL,
    CONSTRAINT monthly_balance_snapshot_pkey PRIMARY KEY (id),
    CONSTRAINT monthly_balance_snapshot_period_uniq UNIQUE (user_id, month, year),
    CONSTRAINT monthly_balance_snapshot_month_check CHECK ((month >= 1) AND (month <= 12)),
    CONSTRAINT monthly_balance_snapshot_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);


--
-- Name: recurring_payments
--
-- Note: id is integer/serial here while every other table uses uuid. That is
-- how the live database was built; transactions.recurring_payment_id must
-- therefore be integer.
--
CREATE SEQUENCE public.recurring_payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE public.recurring_payments (
    id integer DEFAULT nextval('public.recurring_payments_id_seq'::regclass) NOT NULL,
    amount numeric(10,2) NOT NULL,
    day_of_month integer NOT NULL,
    description character varying(255),
    account_id uuid,
    category character varying(50) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    user_id uuid NOT NULL,
    CONSTRAINT recurring_payments_pkey PRIMARY KEY (id),
    CONSTRAINT recurring_payments_day_of_month_check CHECK ((day_of_month >= 1) AND (day_of_month <= 31)),
    -- Composite, so a payment can only point at an account its own user owns.
    -- account_id is nullable, and MATCH SIMPLE skips the check when it is NULL.
    CONSTRAINT recurring_payments_account_id_fkey FOREIGN KEY (account_id, user_id)
        REFERENCES public.accounts(id, user_id),
    CONSTRAINT recurring_payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);

CREATE INDEX idx_recurring_payments_user_id ON public.recurring_payments USING btree (user_id);

ALTER SEQUENCE public.recurring_payments_id_seq OWNED BY public.recurring_payments.id;

COMMENT ON COLUMN public.recurring_payments.day_of_month IS
    'Clamped to the length of the target month at run time, so 31 still fires in February.';


--
-- Name: transactions
--
CREATE TABLE public.transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date date NOT NULL,
    amount numeric(10,2) NOT NULL,
    description text NOT NULL,
    category public."Category" NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    account_id uuid NOT NULL,
    recurring_payment_id integer,
    period_year smallint,
    period_month smallint,
    user_id uuid NOT NULL,
    CONSTRAINT "Transactions_pkey" PRIMARY KEY (id),
    -- account_id is NOT NULL, so ON DELETE SET NULL could never succeed.
    -- RESTRICT is a backstop only: the app archives accounts, never deletes them.
    -- Composite, so a transaction can only land in an account its user owns.
    CONSTRAINT transactions_account_id_fkey FOREIGN KEY (account_id, user_id)
        REFERENCES public.accounts(id, user_id) ON DELETE RESTRICT,
    CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT transactions_recurring_payment_id_fkey FOREIGN KEY (recurring_payment_id)
        REFERENCES public.recurring_payments(id) ON DELETE SET NULL
);

COMMENT ON COLUMN public.transactions.recurring_payment_id IS
    'Set only on rows generated by scripts/process-recurring-payments.ts.';
COMMENT ON COLUMN public.transactions.period_month IS
    'The ET month this recurring charge was applied for. With period_year and recurring_payment_id, makes the job idempotent.';

CREATE INDEX idx_transactions_date ON public.transactions USING btree (date);
-- Every per-user date-range query (dashboard, history, monthly totals, the
-- snapshot job) filters on both.
CREATE INDEX idx_transactions_user_id_date ON public.transactions USING btree (user_id, date);
CREATE INDEX idx_transactions_category ON public.transactions USING btree (category);
CREATE INDEX idx_transactions_account_id ON public.transactions USING btree (account_id);

-- Idempotency guard for the recurring-payments job: at most one generated
-- transaction per (payment, month). The job inserts with ON CONFLICT DO
-- NOTHING and skips the balance update when no row comes back, so a rerun
-- cannot double-charge.
CREATE UNIQUE INDEX transactions_recurring_period_uniq
    ON public.transactions (recurring_payment_id, period_year, period_month)
    WHERE recurring_payment_id IS NOT NULL;
