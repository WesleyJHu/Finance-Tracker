/**
 * Test-database plumbing.
 *
 * The integration tests run against a real Postgres, because the bugs they
 * guard are about transactions, constraints, and concurrency — none of which
 * a mock can reproduce. The database is created from db/schema.sql and
 * dropped and rebuilt for every run.
 */
import fs from "node:fs"
import path from "node:path"
import { Client } from "pg"

const APP_ROOT = path.resolve(__dirname, "../../..")

/**
 * The URL of the throwaway test database, derived from DATABASE_URL by
 * swapping the database name.
 *
 * Deriving it rather than hardcoding one means no credentials live in the
 * repo, and the guard below means a stray DATABASE_URL pointing at real data
 * still cannot be dropped: the name must end in `_test`.
 */
export function testDatabaseUrl(): { admin: string; test: string; name: string } {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  if (!base) {
    throw new Error(
      "Set DATABASE_URL (or TEST_DATABASE_URL) to a Postgres you are willing " +
        "to create a throwaway database on. See finance-app/README.md."
    )
  }

  const url = new URL(base)
  const source = url.pathname.replace(/^\//, "")
  const name = source.endsWith("_test") ? source : `${source}_test`

  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to use ${name} as a test database.`)
  }

  const test = new URL(url.toString())
  test.pathname = `/${name}`

  // Connect to the maintenance database to issue CREATE/DROP DATABASE, which
  // cannot run inside the database being dropped.
  const admin = new URL(url.toString())
  admin.pathname = "/postgres"

  return { admin: admin.toString(), test: test.toString(), name }
}

/** Drops and recreates the test database, then applies db/schema.sql. */
export async function resetTestDatabase(): Promise<string> {
  const { admin, test, name } = testDatabaseUrl()

  const adminClient = new Client({ connectionString: admin })
  await adminClient.connect()
  try {
    // Terminate leftover sessions, or DROP DATABASE blocks indefinitely.
    await adminClient.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name]
    )
    await adminClient.query(`DROP DATABASE IF EXISTS "${name}"`)
    await adminClient.query(`CREATE DATABASE "${name}"`)
  } finally {
    await adminClient.end()
  }

  const schema = fs.readFileSync(path.join(APP_ROOT, "db", "schema.sql"), "utf8")
  const schemaClient = new Client({ connectionString: test })
  await schemaClient.connect()
  try {
    await schemaClient.query(schema)
  } finally {
    await schemaClient.end()
  }

  return test
}

/** Empties every table, leaving the schema in place. */
export async function truncateAll(client: {
  query: (sql: string) => Promise<unknown>
}): Promise<void> {
  await client.query(
    `TRUNCATE transactions, recurring_payments, monthly_balance_snapshot,
              monthly_budgets, accounts RESTART IDENTITY CASCADE`
  )
}

export { APP_ROOT }
