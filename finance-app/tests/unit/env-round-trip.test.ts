/**
 * That a generated hash survives being written to a .env file and read back.
 *
 * This is the test that was missing, and its absence is why the bug shipped:
 * every other auth test sets process.env directly, and the container test
 * passed the hash with `docker -e`. Both bypass the .env file entirely.
 *
 * Next does not use plain dotenv — it runs dotenv-expand, which treats `$` in
 * a value as a variable reference. The old `scrypt$N$r$p$salt$hash` format
 * therefore loaded back as `scrypt31072==...`, with the parameters and most of
 * the salt expanded to nothing, so no password could ever match. It failed the
 * same way in production.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { loadEnvConfig } from "@next/env"
import { hashPassword, isValidHashFormat, verifyPassword } from "@/lib/password"

const PASSWORD = "a password with spaces"

let dir: string
const savedEnv = { ...process.env }

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

  delete process.env.AUTH_SECRET
  delete process.env.AUTH_PASSWORD_HASH

  // forceReload, because @next/env memoises the first result process-wide and
  // would otherwise hand back the previous test's values.
  const { combinedEnv } = loadEnvConfig(dir, true, { info: () => {}, error: () => {} }, true)
  return combinedEnv as NodeJS.ProcessEnv
}

describe("a generated hash survives Next's env loader", () => {
  it("round-trips through a .env file and still verifies", async () => {
    const hash = await hashPassword(PASSWORD)
    const env = loadAsNextWould(`AUTH_PASSWORD_HASH=${hash}\n`)

    expect(env.AUTH_PASSWORD_HASH).toBe(hash)
    expect(await verifyPassword(PASSWORD, env.AUTH_PASSWORD_HASH!)).toBe(true)
  }, 60_000)

  it("contains no character dotenv-expand would consume", async () => {
    // The direct statement of the rule, so a future format change that
    // reintroduces `$` fails here rather than in someone's login form.
    const hash = await hashPassword(PASSWORD)
    expect(hash).not.toContain("$")
  }, 60_000)

  it("survives alongside other variables", async () => {
    const hash = await hashPassword(PASSWORD)
    const env = loadAsNextWould(
      [
        "DATABASE_URL=postgresql://user:pw%20with%20space@host:5432/db",
        `AUTH_SECRET=c29tZS1zZWNyZXQ=`,
        `AUTH_PASSWORD_HASH=${hash}`,
        "",
      ].join("\n")
    )

    expect(env.AUTH_PASSWORD_HASH).toBe(hash)
    expect(env.AUTH_SECRET).toBe("c29tZS1zZWNyZXQ=")
    expect(await verifyPassword(PASSWORD, env.AUTH_PASSWORD_HASH!)).toBe(true)
  }, 60_000)

  it("demonstrates what the old $-separated format did", async () => {
    // Not a hypothetical: this is the exact shape that shipped.
    const legacy = "scrypt$131072$8$1$c2FsdHNhbHRzYWx0c2E=$aGFzaGhhc2hoYXNo"
    const env = loadAsNextWould(`AUTH_PASSWORD_HASH=${legacy}\n`)

    expect(env.AUTH_PASSWORD_HASH).not.toBe(legacy)
    expect(isValidHashFormat(env.AUTH_PASSWORD_HASH)).toBe(false)
  })

  it("still accepts a legacy $-separated hash from a real environment variable", async () => {
    // docker -e and compose never go through dotenv-expand, so an intact
    // legacy hash must keep working rather than locking someone out.
    const { randomBytes, scrypt } = await import("node:crypto")
    const { promisify } = await import("node:util")
    const scryptAsync = promisify(scrypt) as (
      p: string,
      s: Buffer,
      k: number,
      o: { N: number; r: number; p: number; maxmem: number }
    ) => Promise<Buffer>

    const salt = randomBytes(16)
    const derived = await scryptAsync(PASSWORD, salt, 64, {
      N: 2 ** 14,
      r: 8,
      p: 1,
      maxmem: 256 * 1024 * 1024,
    })
    const legacy = `scrypt$16384$8$1$${salt.toString("base64")}$${derived.toString("base64")}`

    expect(isValidHashFormat(legacy)).toBe(true)
    expect(await verifyPassword(PASSWORD, legacy)).toBe(true)
    expect(await verifyPassword("wrong", legacy)).toBe(false)
  }, 60_000)
})

describe("isValidHashFormat", () => {
  it("accepts both separators and rejects anything else", async () => {
    expect(isValidHashFormat(await hashPassword(PASSWORD))).toBe(true)
    expect(isValidHashFormat("scrypt$131072$8$1$c2FsdA==$aGFzaA==")).toBe(true)

    for (const value of [
      undefined,
      "",
      // What dotenv-expand left behind.
      "scrypt31072==/TMbyn0YVyRaSpAifbMSzf5ix4Xtk2LwqrVaSaBvMEZ4w==",
      "scrypt:131072:8:1",
      "bcrypt:131072:8:1:c2FsdA==:aGFzaA==",
      "just-a-password",
    ]) {
      expect(isValidHashFormat(value), String(value)).toBe(false)
    }
  }, 60_000)
})
