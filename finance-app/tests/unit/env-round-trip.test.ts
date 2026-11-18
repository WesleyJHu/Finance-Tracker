/**
 * That the auth settings survive being written to a .env file and read back.
 *
 * Next does not use plain dotenv — it runs dotenv-expand, which treats `$` in
 * a value as a variable reference. The old password hash used `$` as its
 * separator and loaded back destroyed, so no password could ever match; every
 * other test set process.env directly and so never saw it. This is the test
 * that would have caught it, kept for the settings that replaced the hash.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { loadEnvConfig } from "@next/env"
import { parseAllowedEmails } from "@/lib/auth"

let dir: string
const savedEnv = { ...process.env }

const KEYS = ["AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "AUTH_URL", "AUTH_ALLOWED_EMAILS"]

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "finance-env-"))
})

afterEach(() => {
  process.env = { ...savedEnv }
  fs.rmSync(dir, { recursive: true, force: true })
})

/** Loads a .env file exactly the way `next dev` and `next start` do. */
function loadAsNextWould(contents: string): NodeJS.ProcessEnv {
  fs.writeFileSync(path.join(dir, ".env"), contents, "utf8")
  for (const key of KEYS) delete process.env[key]

  // forceReload, because @next/env memoises the first result process-wide and
  // would otherwise hand back the previous test's values.
  const { combinedEnv } = loadEnvConfig(dir, true, { info: () => {}, error: () => {} }, true)
  return combinedEnv as NodeJS.ProcessEnv
}

describe("auth settings survive Next's env loader", () => {
  it("round-trips a generated secret and Google-shaped values", () => {
    const values = {
      // What auth:setup generates: base64, so + / and = but never $.
      AUTH_SECRET: randomBytes(32).toString("base64"),
      // Deliberately not shaped exactly like real credentials: GitHub's push
      // protection blocks a push containing anything that matches Google's
      // client ID or GOCSPX- secret patterns, fake or not.
      GOOGLE_CLIENT_ID: "fake-client-id-for-tests.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "fake-client-secret_with-dashes+and/slashes=",
      AUTH_URL: "https://nas.example-tailnet.ts.net",
      AUTH_ALLOWED_EMAILS: "one@gmail.com, two@gmail.com",
    }

    const env = loadAsNextWould(
      [
        "DATABASE_URL=postgresql://user:pw%20with%20space@host:5432/db",
        ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
        "",
      ].join("\n")
    )

    for (const [key, value] of Object.entries(values)) {
      expect(env[key], key).toBe(value)
    }
    expect(parseAllowedEmails(env.AUTH_ALLOWED_EMAILS)).toEqual(new Set(["one@gmail.com", "two@gmail.com"]))
  })

  it("keeps `*` for the allowlist literally", () => {
    const env = loadAsNextWould("AUTH_ALLOWED_EMAILS=*\n")
    expect(parseAllowedEmails(env.AUTH_ALLOWED_EMAILS)).toBe("*")
  })

  it("never generates a secret containing `$`", () => {
    // The direct statement of the rule, for the one value the app generates.
    for (let i = 0; i < 200; i++) {
      expect(randomBytes(32).toString("base64")).not.toContain("$")
    }
  })

  it("demonstrates what a `$` in a value does, and that escaping it works", () => {
    // Why .env.example warns about it: a client secret or database password
    // containing `$` is silently truncated unless written as \$.
    const env = loadAsNextWould("GOOGLE_CLIENT_SECRET=abc$def\nAUTH_SECRET=abc\\$def\n")
    expect(env.GOOGLE_CLIENT_SECRET).not.toBe("abc$def")
    expect(env.AUTH_SECRET).toBe("abc$def")
  })
})
