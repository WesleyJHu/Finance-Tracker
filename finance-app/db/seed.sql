--
-- Finance-Tracker — minimum seed for a runnable database
--
--     psql "$DATABASE_URL" -f db/schema.sql
--     psql "$DATABASE_URL" -f db/seed.sql
--
-- Safe to re-run: every statement is ON CONFLICT DO NOTHING.
--
-- This seeds only what the app needs in order to boot without 500ing. It does
-- not create accounts — add those through the UI.
--

-- ---------------------------------------------------------------------------
-- monthly_budgets — 12 rows, one per month, reused every year
-- ---------------------------------------------------------------------------
-- The app has no POST for this table, so without these rows the Settings
-- budget inputs are frozen and the monthly snapshot job aborts with
-- "No budget found for month N". Adjust base_budget in Settings afterwards.

INSERT INTO monthly_budgets (month, base_budget) VALUES
    (1, 0), (2, 0), (3, 0), (4, 0), (5, 0), (6, 0),
    (7, 0), (8, 0), (9, 0), (10, 0), (11, 0), (12, 0)
ON CONFLICT (month) DO NOTHING;


-- ---------------------------------------------------------------------------
-- monthly_balance_snapshot — bootstrap row for the current month
-- ---------------------------------------------------------------------------
-- The dashboard reads this to compute Remaining Budget, and the monthly job
-- reads the previous month's row to roll forward. Without a first row the app
-- shows a zeroed budget until the job first runs.
--
-- starting_balance is defined as: previous month's ending_balance + this
-- month's base_budget. For the very first month there is no previous month,
-- so it is just the base budget. See the header of db/schema.sql.

INSERT INTO monthly_balance_snapshot (starting_balance, ending_balance, month, year)
SELECT
    COALESCE((SELECT base_budget FROM monthly_budgets WHERE month = period.m), 0),
    NULL,
    period.m,
    period.y
FROM (
    SELECT
        EXTRACT(MONTH FROM now() AT TIME ZONE 'America/New_York')::smallint AS m,
        EXTRACT(YEAR  FROM now() AT TIME ZONE 'America/New_York')::smallint AS y
) AS period
ON CONFLICT (month, year) DO NOTHING;
