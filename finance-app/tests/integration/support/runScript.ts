/**
 * Runs a cron script as a real subprocess against the test database.
 *
 * Spawning rather than importing is deliberate: both scripts self-execute on
 * import and call `process.exit`, and their exit code is part of what is under
 * test — the old versions swallowed every error and exited 0, so the worker
 * could never tell a failed run from a successful one.
 */
import { execFile } from "node:child_process"
import path from "node:path"
import { APP_ROOT } from "./database"

export type ScriptResult = {
  code: number
  stdout: string
  stderr: string
}

const NPM = process.platform === "win32" ? "npm.cmd" : "npm"

export function runScript(npmScript: string): Promise<ScriptResult> {
  return new Promise((resolve) => {
    execFile(
      NPM,
      ["run", "--silent", npmScript],
      {
        cwd: APP_ROOT,
        // Hands the throwaway database down. src/lib/db.ts prefers a real
        // environment variable over .env.local, so this wins.
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
        maxBuffer: 32 * 1024 * 1024,
        shell: process.platform === "win32",
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as NodeJS.ErrnoException & { code?: number }).code === "number"
            ? ((error as unknown as { code: number }).code as number)
            : error
              ? 1
              : 0
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      }
    )
  })
}

export const SCRIPTS = {
  recurring: "process-recurring",
  snapshot: "process-monthly-snapshot",
} as const

export { path }
