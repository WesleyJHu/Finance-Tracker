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
    console.log("Running monthly snapshot job...");
    await runScript("./scripts/process-monthly-balance-snapshot.mjs");
  },
  {
    timezone: "America/New_York",
  }
);

console.log("Worker started...");
