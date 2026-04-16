# Finance App Scripts

This directory contains automated scripts for the finance tracking application.

## Monthly Balance Snapshot Script

This script should be run at the start of each new month to create balance snapshots and update budget tracking.

### How it works

The script runs monthly and:

1. **Updates Previous Month**: Sets the ending balance of the previous month to the current total account balance
2. **Calculates Starting Balance**: Takes the previous month's ending balance and adds the new month's base budget
3. **Creates New Snapshot**: Creates or updates a balance snapshot for the current month with the calculated starting balance

### Setup Cron Job

#### On Linux/Mac

1. Open crontab: `crontab -e`
2. Add this line to run at 12:01 AM on the 1st of each month:
   ```
   1 0 1 * * cd /path/to/your/finance-app && npm run process-monthly-snapshot
   ```

#### On Windows

1. Open Task Scheduler
2. Create a new task
3. Set trigger to "Monthly" on the 1st day at 12:01 AM
4. Set action to "Start a program"
5. Program: `cmd.exe`
6. Arguments: `/c cd /d "C:\path\to\your\finance-app" && npm run process-monthly-snapshot`

#### Using PM2

```bash
pm2 start npm --name "monthly-snapshot" -- run process-monthly-snapshot
pm2 save
```

### Manual Testing

To test the script manually:

```bash
cd finance-app
npm run process-monthly-snapshot
```

## Recurring Payments Cron Job Setup

This script automatically processes recurring payments and creates transactions for due payments.

### How it works

The script runs daily and checks all recurring payments to see if they're due based on:

- **Monthly**: Processes on the specified day of each month
- **Weekly**: Processes on the specified day of the week (assuming day_of_month 1=Monday, 2=Tuesday, ..., 7=Sunday)
- **Yearly**: Processes on the specified day of January each year

When a payment is due, it:

1. Creates a new transaction in the database
2. Updates the associated account balance and max limit
3. Logs the processing

### Setup Cron Job

#### On Linux/Mac

1. Open crontab: `crontab -e`
2. Add this line to run at 12:01 AM every day:
   ```
   1 0 * * * cd /path/to/your/finance-app && npm run process-recurring
   ```

#### On Windows

1. Open Task Scheduler
2. Create a new task
3. Set trigger to "Daily" at 12:01 AM
4. Set action to "Start a program"
5. Program: `cmd.exe`
6. Arguments: `/c cd /d "C:\path\to\your\finance-app" && npm run process-recurring`

#### Using PM2 (recommended for production)

If you're using PM2 to manage your Next.js app:

```bash
pm2 start npm --name "recurring-payments" -- run process-recurring
pm2 save
```

### Manual Testing

To test the script manually:

```bash
npm run process-recurring
```

The script file is located at `scripts/process-recurring-payments.mjs`

## Important Notes

- **Weekly payments**: The `day_of_month` field is interpreted as day of week (1=Monday, 2=Tuesday, ..., 7=Sunday)
- **Yearly payments**: Only process on the specified day of January
- Ensure the database connection is properly configured
- The script updates both transaction records and account balances automatically
