/**
 * Builds the throwaway database once per run, before any test file loads.
 *
 * src/lib/db.ts reads DATABASE_URL at module load and caches a Pool, so the
 * URL has to be in the environment before the first import. Setting it here
 * is not enough on its own — vitest.config.ts also passes it through
 * `test.env` so worker processes see it.
 */
import fs from "node:fs"
import path from "node:path"
import dotenv from "dotenv"
import { resetTestDatabase, testDatabaseUrl, APP_ROOT } from "./database"

export default async function setup() {
  if (!process.env.DATABASE_URL && !process.env.TEST_DATABASE_URL) {
    const envPath = path.join(APP_ROOT, ".env.local")
    if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
  }

  const { test } = testDatabaseUrl()
  process.env.DATABASE_URL = test
  process.env.TEST_DATABASE_URL = test

  await resetTestDatabase()
}
