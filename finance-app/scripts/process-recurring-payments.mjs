import { pool } from './db.mjs';

async function processRecurringPayments() {
  console.log('Starting recurring payments processing...');

  try {
    // Get current date
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(now);

    const currentDay = Number(parts.find(p => p.type === "day")?.value); // 1-31
    const currentMonth = Number(parts.find(p => p.type === "month")?.value ?? 0);

    console.log(`Current date: ${now.toISOString()}, day: ${currentDay}, month: ${currentMonth}`);

    // Fetch all recurring payments
    const recurringQuery = 'SELECT * FROM recurring_payments';
    const recurringResult = await pool.query(recurringQuery);
    const recurringPayments = recurringResult.rows;

    console.log(`Found ${recurringPayments.length} recurring payments`);

    let processedCount = 0;

    for (const payment of recurringPayments) {
      let isDue = payment.day_of_month === currentDay;

      if (isDue) {
        console.log(`Processing due payment: ${payment.description || payment.category}`);

        // Create transaction
        const transactionData = {
          date: now.toISOString().split('T')[0], // YYYY-MM-DD format
          amount: Number(payment.amount),
          description: payment.description || `${payment.category} (Recurring)`,
          category: payment.category.toLowerCase(),
          account_id: payment.account_id
        };

        const insertQuery = `
          INSERT INTO transactions (date, amount, description, category, account_id)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
        `;

        const insertValues = [
          transactionData.date,
          transactionData.amount,
          transactionData.description,
          transactionData.category,
          transactionData.account_id
        ];

        try {
          const insertResult = await pool.query(insertQuery, insertValues);
          console.log(`Created transaction for payment ${payment.id}: ${insertResult.rows[0].id}`);

          // Update account balance
          const accountQuery = 'SELECT balance, max, type FROM accounts WHERE id = $1';
          const accountResult = await pool.query(accountQuery, [payment.account_id]);

          if (accountResult.rows.length > 0) {
            const account = accountResult.rows[0];
            let newBalance = Number(account.balance);
            let newMax = Number(account.max);

            // Apply transaction effects (similar to the frontend logic)
            const isCreditAccount = account.type?.toLowerCase().includes('credit');
            const delta = payment.category.toLowerCase() === 'income' ? 0 : -payment.amount;
            const maxDelta = payment.category.toLowerCase() === 'income' ? payment.amount : 0;

            newBalance += Number(delta);
            if (!isCreditAccount) {
              newMax += Number(maxDelta);
            }

            // Update account
            await pool.query(
              'UPDATE accounts SET balance = $1, max = $2 WHERE id = $3',
              [newBalance, newMax, payment.account_id]
            );

            console.log(`Updated account ${payment.account_id} balance to ${newBalance}`);
          }

          processedCount++;
        } catch (error) {
          console.error(`Error creating transaction for payment ${payment.id}:`, error);
          console.log("──────────────");
          console.log("PAYMENT DEBUG:");
          console.log({
            id: payment.id,
            rawAmount: payment.amount,
            parsedAmount: Number(payment.amount),
            category: payment.category,
            account_id: payment.account_id,
          });
          console.log("──────────────");
        }
      }
    }

    console.log(`Processed ${processedCount} recurring payments`);

  } catch (error) {
    console.error('Error processing recurring payments:', error);
  } finally {
    // Close the database connection
    await pool.end();
  }
}

// Run the script
processRecurringPayments()
  .then(() => {
    console.log('Recurring payments processing completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });