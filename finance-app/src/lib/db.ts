import path from "node:path"
import fs from "node:fs"
import dotenv from "dotenv"
import { Pool, type PoolClient } from "pg"

// Next loads .env.local automatically; the CLI scripts in scripts/ do not.
// Load it here so both entry points behave identically. Real environment
// variables always win (dotenv never overrides), so docker compose — which
// passes DATABASE_URL directly — is unaffected, and this is a no-op there.
if (!process.env.DATABASE_URL) {
  // npm run always sets cwd to the package root, so this resolves for
  // `npm run process-recurring` as well as `npm run dev`.
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath })
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local (local dev) " +
      "or pass it as an environment variable (docker compose)."
  )
}

function createPool(): Pool {
  const created = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Stops a runaway query from pinning a connection forever.
    statement_timeout: 15_000,
  })

  // Without this handler an error on an *idle* client is an unhandled 'error'
  // event, which takes down the whole Next server process.
  created.on("error", (err) => {
    console.error("Unexpected error on idle Postgres client:", err)
  })

  return created
}

// `next dev` re-evaluates this module on every HMR reload, which would leak a
// new Pool each time. Cache it on globalThis in development only.
const globalForPg = globalThis as typeof globalThis & { __financePool?: Pool }

export const pool: Pool = globalForPg.__financePool ?? createPool()

if (process.env.NODE_ENV !== "production") {
  globalForPg.__financePool = pool
}

/**
 * An error carrying the HTTP status a route should respond with.
 *
 * Throwing this from inside a `withTransaction` callback aborts and rolls back
 * the transaction cleanly, which is why the routes no longer need to issue a
 * bare ROLLBACK before returning an early error response.
 */
export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "HttpError"
    this.status = status
  }
}

/**
 * Run `fn` inside a single database transaction on a single connection.
 *
 * This exists because the previous code issued BEGIN/COMMIT/ROLLBACK through
 * `pool.query()`, which checks out an arbitrary idle connection per call —
 * there was no guarantee the BEGIN, the writes, and the COMMIT ran on the same
 * session, so the routes had no atomicity at all.
 *
 * Every query inside `fn` MUST use the supplied `client`, not the pool.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect()

  try {
    await client.query("BEGIN")
    const result = await fn(client)
    await client.query("COMMIT")
    return result
  } catch (error) {
    // A failed ROLLBACK must not mask the error that caused it.
    try {
      await client.query("ROLLBACK")
    } catch (rollbackError) {
      console.error("ROLLBACK failed:", rollbackError)
    }
    throw error
  } finally {
    client.release()
  }
}
