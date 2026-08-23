/**
 * Cron scheduler for the two maintenance jobs.
 *
 * Started by the `worker` service in docker-compose.yml (`npm run worker`).
 * Before that service existed nothing ran this file, so the jobs below were
 * almost certainly never firing in production.
 */
import cron from "node-cron";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const TIMEZONE = "America/New_York";

const SCRIPTS = {
  recurring: {
    npmScript: "process-recurring",
    bundle: "scripts/process-recurring-payments.mjs",
  },
  snapshot: {
    npmScript: "process-monthly-snapshot",
    bundle: "scripts/process-monthly-balance-snapshot.mjs",
  },
};

// Absolute, so the worker does not depend on being started from finance-app/.
const PACKAGE_ROOT = fileURLToPath(new URL(".", import.meta.url));
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

/**
 * How to invoke one job.
 *
 * In the runtime image this file IS dist/worker.mjs and the bundled scripts sit
 * beside it, so they run directly on node — the image has no tsx, no
 * TypeScript sources and no tsconfig, by design.
 *
 * In development neither exists, so it falls back to the package.json script,
 * which keeps `npm run process-recurring` by hand and the scheduled run the
 * same command.
 */
function commandFor(job) {
  const bundled = path.join(PACKAGE_ROOT, job.bundle);
  return fs.existsSync(bundled)
    ? { file: process.execPath, args: [bundled] }
    : { file: NPM, args: ["run", "--silent", job.npmScript] };
}

function runScript(job) {
  const { file, args } = commandFor(job);
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        cwd: PACKAGE_ROOT,
        // The default 1 MB is enough to ENOBUFS on a long account list and
        // report a successful run as a failure.
        maxBuffer: 32 * 1024 * 1024,
        shell: file === NPM && process.platform === "win32",
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

function enqueue(label, job) {
  queue = queue
    .then(async () => {
      console.log(`[CRON] ${label} starting`);
      await runScript(job);
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

console.log(
  `Worker started... (timezone ${TIMEZONE}, ` +
    `${fs.existsSync(path.join(PACKAGE_ROOT, SCRIPTS.recurring.bundle)) ? "bundled" : "source"} scripts)`
);
