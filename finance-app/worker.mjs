/**
 * Cron scheduler for the two maintenance jobs.
 *
 * Started by the `worker` service in docker-compose.yml (`npm run worker`).
 * Before that service existed nothing ran this file, so the jobs below were
 * almost certainly never firing in production.
 */
import cron from "node-cron";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const TIMEZONE = "America/New_York";

// The package.json scripts stay the single source of truth for how these are
// invoked, so `npm run process-recurring` by hand and the scheduled run are
// always the same command.
const SCRIPTS = {
  recurring: "process-recurring",
  snapshot: "process-monthly-snapshot",
};

// Absolute, so the worker does not depend on being started from finance-app/.
const PACKAGE_ROOT = fileURLToPath(new URL(".", import.meta.url));
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function runScript(npmScript) {
  return new Promise((resolve, reject) => {
    execFile(
      NPM,
      ["run", "--silent", npmScript],
      {
        cwd: PACKAGE_ROOT,
        // The default 1 MB is enough to ENOBUFS on a long account list and
        // report a successful run as a failure.
        maxBuffer: 32 * 1024 * 1024,
        shell: process.platform === "win32",
      },
      (error, stdout, stderr) => {
        if (stdout) process.stdout.write(stdout);
        // stderr used to be captured and discarded, so script warnings vanished.
        if (stderr) process.stderr.write(stderr);

        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      }
    );
  });
}

/**
 * Both jobs fire at midnight on the 1st and both write accounts.balance, with
 * no locking and undefined ordering between them. Chaining every job through
 * one promise means two can never overlap, whatever the schedules are.
 */
let queue = Promise.resolve();

function enqueue(label, npmScript) {
  queue = queue
    .then(async () => {
      console.log(`[CRON] ${label} starting`);
      await runScript(npmScript);
      console.log(`[CRON] ${label} completed successfully`);
    })
    .catch((error) => {
      // Swallow here so one failed job does not break the chain for the next.
      console.error(`[CRON] ${label} failed:`, error);
    });
  return queue;
}

// Daily at midnight ET.
cron.schedule("0 0 * * *", () => enqueue("recurring payments", SCRIPTS.recurring), {
  timezone: TIMEZONE,
});

// Midnight ET on the 1st. Queued behind the daily job if both fire together.
cron.schedule("0 0 1 * *", () => enqueue("monthly snapshot", SCRIPTS.snapshot), {
  timezone: TIMEZONE,
});

console.log(`Worker started... (timezone ${TIMEZONE})`);
