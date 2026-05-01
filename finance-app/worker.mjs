import cron from "node-cron";
import { exec } from "child_process";

function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    exec(`node ${scriptPath}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error running ${scriptPath}:`, error);
        reject(error);
        return;
      }
      console.log(stdout);
      resolve(stdout);
    });
  });
}

cron.schedule(
  "0 0 * * *",
  async () => {
    console.log("Running daily recurring payments job...");
    await runScript("./scripts/process-recurring-payments.mjs");
  },
  {
    timezone: "America/New_York",
  }
);

cron.schedule(
  "0 0 1 * *",
  async () => {
    console.log("[CRON] Running monthly snapshot job...");

    try {
      await runScript("./scripts/process-monthly-balance-snapshot.mjs");
      console.log("[CRON] Snapshot job completed successfully");
    } catch (err) {
      console.error("[CRON] Snapshot job failed:", err);
    }
  },
  { timezone: "America/New_York" }
);

console.log("Worker started...");
