import { pool } from './db.mjs';

async function processMonthlyBalanceSnapshot() {
  console.log('Starting monthly balance snapshot processing...');

  try {
    // Get current date
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(now);

    const currentMonth = Number(parts.find(p => p.type === "month")?.value);
    const currentYear = Number(parts.find(p => p.type === "year")?.value);

    // Calculate previous month
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = prevDate.getMonth() + 1;
    const prevYear = prevDate.getFullYear();

    console.log(`Current month: ${currentMonth}/${currentYear}`);
    console.log(`Previous month: ${prevMonth}/${prevYear}`);

    // Get current total balance which is starting_balance + all income - all expenses
    const totalExpensesQuery = 'SELECT COALESCE(SUM(amount), 0) AS total_expenses FROM transactions WHERE category != $1 AND EXTRACT(MONTH FROM date) = $2 AND EXTRACT(YEAR FROM date) = $3';
    const totalIncomeQuery = 'SELECT COALESCE(SUM(amount), 0) AS total_income FROM transactions WHERE category = $1 AND EXTRACT(MONTH FROM date) = $2 AND EXTRACT(YEAR FROM date) = $3';
    const totalExpensesResult = await pool.query(totalExpensesQuery, ['income', currentMonth, currentYear]);
    const totalIncomeResult = await pool.query(totalIncomeQuery, ['income', currentMonth, currentYear]);
    const startingBalanceQuery = 'SELECT starting_balance FROM monthly_balance_snapshot WHERE month = $1 AND year = $2';
    const startingBalanceResult = await pool.query(startingBalanceQuery, [prevMonth, prevYear]);
    const currentBalance = Number(startingBalanceResult.rows[0].starting_balance) + Number(totalIncomeResult.rows[0].total_income) - Number(totalExpensesResult.rows[0].total_expenses);

    console.log(`Current total balance: $${currentBalance.toFixed(2)}`);

    // Update previous month's ending balance (if it exists)
    const updatePrevSnapshotQuery = `
      UPDATE monthly_balance_snapshot
      SET ending_balance = $1
      WHERE month = $2 AND year = $3
      RETURNING *
    `;
    const updateResult = await pool.query(updatePrevSnapshotQuery, [currentBalance, prevMonth, prevYear]);

    if (updateResult.rowCount > 0) {
      console.log(`Updated previous month (${prevMonth}/${prevYear}) ending balance to $${currentBalance.toFixed(2)}`);
    } else {
      console.log(`No balance snapshot found for previous month (${prevMonth}/${prevYear}) - this might be the first run`);
    }

    // Get current month's base budget
    const budgetQuery = 'SELECT * FROM monthly_budgets WHERE month = $1';
    const budgetResult = await pool.query(budgetQuery, [currentMonth]);

    if (budgetResult.rows.length === 0) {
      console.error(`No budget found for month ${currentMonth}`);
      return;
    }

    const baseBudget = Number(budgetResult.rows[0].base_budget);
    console.log(`Current month base budget: $${baseBudget.toFixed(2)}`);

    // Calculate starting balance for current month
    // This should be the previous month's ending balance + current month's base budget
    const prevEndingBalance = updateResult.rowCount > 0 ? Number(updateResult.rows[0].ending_balance) : currentBalance;
    const startingBalance = prevEndingBalance + baseBudget;

    console.log(`Previous month ending balance: $${prevEndingBalance.toFixed(2)}`);
    console.log(`Starting balance for current month: $${startingBalance.toFixed(2)}`);

    // Check if balance snapshot already exists for current month
    const existingSnapshotQuery = 'SELECT * FROM monthly_balance_snapshot WHERE month = $1 AND year = $2';
    const existingSnapshotResult = await pool.query(existingSnapshotQuery, [currentMonth, currentYear]);

    if (existingSnapshotResult.rows.length > 0) {
      // Update existing snapshot - only update starting_balance, keep existing ending_balance
      const updateCurrentQuery = `
        UPDATE monthly_balance_snapshot
        SET starting_balance = $1
        WHERE month = $2 AND year = $3
        RETURNING *
      `;
      const updateCurrentResult = await pool.query(updateCurrentQuery, [startingBalance, currentMonth, currentYear]);
      console.log(`Updated existing balance snapshot for ${currentMonth}/${currentYear}`);
    } else {
      // Create new balance snapshot with starting_balance only (ending_balance will be set at end of month)
      const insertQuery = `
        INSERT INTO monthly_balance_snapshot (starting_balance, month, year)
        VALUES ($1, $2, $3)
        RETURNING *
      `;
      const insertResult = await pool.query(insertQuery, [startingBalance, currentMonth, currentYear]);
      console.log(`Created new balance snapshot for ${currentMonth}/${currentYear} with starting balance $${startingBalance.toFixed(2)}`);
    }

    console.log('Monthly balance snapshot processing completed successfully');

  } catch (error) {
    console.error('Error processing monthly balance snapshot:', error);
    throw error;
  }
}

// Run the function directly
processMonthlyBalanceSnapshot()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });

export { processMonthlyBalanceSnapshot };