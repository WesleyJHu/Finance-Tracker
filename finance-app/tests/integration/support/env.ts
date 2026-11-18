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

// Fixed, fake auth settings, overriding whatever .env.local holds, so the
// tests never depend on — or sign tokens with — a real secret. Every route
// now requires a session; tests/integration/support/session.ts mints them
// with this secret.
process.env.AUTH_SECRET = "integration-test-secret-not-a-real-one"
process.env.AUTH_ALLOWED_EMAILS = "*"
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com"
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret"
process.env.AUTH_URL = "http://localhost:3000"
delete process.env.AUTH_COOKIE_SECURE
