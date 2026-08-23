/**
 * The session token and password hashing.
 *
 * This is the only code in the app where a bug means unauthorised access
 * rather than a wrong number, so the negative cases matter more than the
 * positive one.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  SESSION_TTL_SECONDS,
  authDisabled,
  createSessionToken,
  readAuthConfig,
  sessionCookieOptions,
  verifySessionToken,
} from "@/lib/auth"
import { hashPassword, verifyPassword } from "@/lib/password"

const SECRET = "test-secret-not-a-real-one"

describe("session tokens", () => {
  it("accepts a token it just signed", async () => {
    const token = await createSessionToken(SECRET)
    expect(await verifySessionToken(SECRET, token)).toBe(true)
  })

  it("rejects a token signed with a different secret", async () => {
    // This is what rotating AUTH_SECRET relies on to sign everyone out.
    const token = await createSessionToken("some-other-secret")
    expect(await verifySessionToken(SECRET, token)).toBe(false)
  })

  it("rejects a token whose payload was edited", async () => {
    const token = await createSessionToken(SECRET)
    const [payload, signature] = token.split(".")

    // Re-encode the payload with an expiry a century out, keeping the original
    // signature. Extending your own session must not be possible.
    const forged = Buffer.from(JSON.stringify({ v: 1, exp: 4102444800 }))
      .toString("base64url")
    expect(await verifySessionToken(SECRET, `${forged}.${signature}`)).toBe(false)

    // And the reverse: original payload, signature from elsewhere.
    const otherSignature = (await createSessionToken("other")).split(".")[1]
    expect(await verifySessionToken(SECRET, `${payload}.${otherSignature}`)).toBe(false)
  })

  it("rejects an expired token", async () => {
    const issuedAt = Date.now()
    const token = await createSessionToken(SECRET, issuedAt)

    const justBefore = issuedAt + SESSION_TTL_SECONDS * 1000 - 1000
    const justAfter = issuedAt + SESSION_TTL_SECONDS * 1000 + 1000

    expect(await verifySessionToken(SECRET, token, justBefore)).toBe(true)
    expect(await verifySessionToken(SECRET, token, justAfter)).toBe(false)
  })

  it("rejects malformed input instead of throwing", async () => {
    for (const value of [
      undefined,
      "",
      "not-a-token",
      "only-one-part",
      "a.b.c",
      ".",
      "!!!.!!!",
      "eyJhIjoxfQ.",
      ".c2ln",
    ]) {
      expect(await verifySessionToken(SECRET, value), JSON.stringify(value)).toBe(false)
    }
  })

  it("rejects a validly-signed token whose payload is not JSON", async () => {
    // Signed by us, so the signature passes — the payload check has to catch it.
    const { createHmac } = await import("node:crypto")
    const payload = Buffer.from("not json at all")
    const signature = createHmac("sha256", SECRET).update(payload).digest()
    const token = `${payload.toString("base64url")}.${signature.toString("base64url")}`

    expect(await verifySessionToken(SECRET, token)).toBe(false)
  })

  it("rejects a validly-signed token with no expiry", async () => {
    const { createHmac } = await import("node:crypto")
    const payload = Buffer.from(JSON.stringify({ v: 1 }))
    const signature = createHmac("sha256", SECRET).update(payload).digest()
    const token = `${payload.toString("base64url")}.${signature.toString("base64url")}`

    expect(await verifySessionToken(SECRET, token)).toBe(false)
  })

  it("produces a different token each time, so one cannot be recognised", async () => {
    const a = await createSessionToken(SECRET, 1_000_000_000_000)
    const b = await createSessionToken(SECRET, 2_000_000_000_000)
    expect(a).not.toBe(b)
  })
})

describe("password hashing", () => {
  // scrypt at N=2^17 is deliberately slow; a handful of calls is a few seconds.
  const PASSWORD = "correct horse battery staple"

  it("accepts the right password and rejects the wrong one", async () => {
    const hash = await hashPassword(PASSWORD)

    expect(await verifyPassword(PASSWORD, hash)).toBe(true)
    expect(await verifyPassword("wrong", hash)).toBe(false)
    expect(await verifyPassword("", hash)).toBe(false)
    expect(await verifyPassword(PASSWORD + " ", hash)).toBe(false)
  }, 60_000)

  it("salts, so the same password hashes differently every time", async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)])

    expect(a).not.toBe(b)
    expect(await verifyPassword(PASSWORD, a)).toBe(true)
    expect(await verifyPassword(PASSWORD, b)).toBe(true)
  }, 60_000)

  it("never stores the password in the hash", async () => {
    const hash = await hashPassword(PASSWORD)
    expect(hash).not.toContain(PASSWORD)
    expect(hash).not.toContain("correct")
    expect(hash.startsWith("scrypt:")).toBe(true)
  }, 60_000)

  it("carries its parameters, so the cost can be raised later", async () => {
    const hash = await hashPassword(PASSWORD)
    // `:`, not `$`: Next runs dotenv-expand over .env files and reads a `$` as
    // a variable reference, which silently destroyed the hash on the way in.
    // See tests/unit/env-round-trip.test.ts.
    const [prefix, cost, blockSize, parallelization] = hash.split(":")

    expect(prefix).toBe("scrypt")
    expect(Number(cost)).toBeGreaterThanOrEqual(2 ** 17)
    expect(Number(blockSize)).toBe(8)
    expect(Number(parallelization)).toBe(1)
  }, 60_000)

  it("returns false for a malformed or tampered hash rather than throwing", async () => {
    for (const stored of [
      "",
      "not-a-hash",
      "scrypt:",
      "scrypt:1:2:3:4",
      "bcrypt:131072:8:1:c2FsdA==:aGFzaA==",
      "scrypt:notanumber:8:1:c2FsdA==:aGFzaA==",
      "scrypt:131072:8:1::",
      // An absurd cost makes scrypt throw; that must read as "no" not a 500.
      "scrypt:999999999:8:1:c2FsdA==:aGFzaA==",
      // The legacy separator with a broken shape is still rejected.
      "scrypt$1$2$3$4",
    ]) {
      expect(await verifyPassword(PASSWORD, stored), stored).toBe(false)
    }
  }, 60_000)
})

describe("configuration", () => {
  const original = { ...process.env }

  beforeEach(() => {
    delete process.env.AUTH_SECRET
    delete process.env.AUTH_PASSWORD_HASH
    delete process.env.AUTH_DISABLED
    delete process.env.AUTH_COOKIE_SECURE
  })

  afterEach(() => {
    process.env = { ...original }
  })

  it("names exactly what is missing", () => {
    const both = readAuthConfig()
    expect(both.ok).toBe(false)
    expect(both.ok === false && both.reason).toContain("AUTH_SECRET")
    expect(both.ok === false && both.reason).toContain("AUTH_PASSWORD_HASH")

    process.env.AUTH_SECRET = "s"
    const one = readAuthConfig()
    expect(one.ok).toBe(false)
    expect(one.ok === false && one.reason).toContain("AUTH_PASSWORD_HASH")
    expect(one.ok === false && one.reason).not.toContain("AUTH_SECRET not set")
  })

  it("is satisfied only when both are present", () => {
    process.env.AUTH_SECRET = "s"
    process.env.AUTH_PASSWORD_HASH = "h"
    expect(readAuthConfig().ok).toBe(true)
  })

  it("treats an empty string as missing, not as configured", () => {
    // An empty AUTH_SECRET would sign tokens anyone could forge.
    process.env.AUTH_SECRET = ""
    process.env.AUTH_PASSWORD_HASH = ""
    expect(readAuthConfig().ok).toBe(false)
  })

  it("only disables auth for the exact string 'true'", () => {
    expect(authDisabled()).toBe(false)
    for (const value of ["", "false", "1", "yes", "TRUE", "True"]) {
      process.env.AUTH_DISABLED = value
      expect(authDisabled(), value).toBe(false)
    }
    process.env.AUTH_DISABLED = "true"
    expect(authDisabled()).toBe(true)
  })
})

describe("session cookie", () => {
  const original = { ...process.env }
  afterEach(() => {
    process.env = { ...original }
  })

  it("is HttpOnly and SameSite=Lax, and not readable by scripts", () => {
    const options = sessionCookieOptions()
    expect(options.httpOnly).toBe(true)
    expect(options.sameSite).toBe("lax")
    expect(options.path).toBe("/")
  })

  it("is not Secure by default, so plain-HTTP LAN access works", () => {
    delete process.env.AUTH_COOKIE_SECURE
    expect(sessionCookieOptions().secure).toBe(false)
  })

  it("is Secure when explicitly enabled for a TLS deployment", () => {
    process.env.AUTH_COOKIE_SECURE = "true"
    expect(sessionCookieOptions().secure).toBe(true)
  })
})
