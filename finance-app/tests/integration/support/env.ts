/**
 * Runs inside each worker before its test file is imported, so DATABASE_URL
 * points at the throwaway database by the time src/lib/db.ts creates its Pool.
 */
import fs from "node:fs"
import path from "node:path"
import dotenv from "dotenv"
import { testDatabaseUrl, APP_ROOT } from "./database"

if (!process.env.DATABASE_URL && !process.env.TEST_DATABASE_URL) {
  const envPath = path.join(APP_ROOT, ".env.local")
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
}

const { test } = testDatabaseUrl()
process.env.DATABASE_URL = test
process.env.TEST_DATABASE_URL = test
