/**
 * Session tokens, auth configuration, and Google ID token checks.
 *
 * This is the code where a bug means unauthorised access — or one user
 * reading another's data — rather than a wrong number, so the negative cases
 * matter more than the positive ones.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createHmac } from "node:crypto"
import {
  SESSION_TTL_SECONDS,
  authenticate,
  createSessionToken,
  isEmailAllowed,
  parseAllowedEmails,
  readGoogleConfig,
  readSessionConfig,
  safeRedirectPath,
  sessionCookieOptions,
  signToken,
  verifySessionToken,
  verifyToken,
} from "@/lib/auth"
import { SignInError, decodeJwtPayload, validateIdTokenClaims } from "@/lib/google"
import { loginErrorMessage } from "@/lib/loginErrors"

const SECRET = "test-secret-not-a-real-one"
const USER = { userId: "11111111-1111-1111-1111-111111111111", email: "me@example.com" }

/** A token signed with SECRET over an arbitrary payload, bypassing signToken's shape. */
function rawToken(payload: unknown): string {
  const bytes = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload))
  const signature = createHmac("sha256", SECRET).update(bytes).digest()
  return `${bytes.toString("base64url")}.${signature.toString("base64url")}`
}

describe("session tokens", () => {
  it("carry the user they were issued for", async () => {
    const token = await createSessionToken(SECRET, USER)
    expect(await verifySessionToken(SECRET, token)).toEqual(USER)
  })

  it("lowercase the email, so the allowlist comparison cannot be dodged by case", async () => {
    const token = await createSessionToken(SECRET, { ...USER, email: "Me@Example.COM" })
    expect((await verifySessionToken(SECRET, token))?.email).toBe("me@example.com")
  })

  it("reject a token signed with a different secret", async () => {
    // This is what rotating AUTH_SECRET relies on to sign everyone out.
    const token = await createSessionToken("some-other-secret", USER)
    expect(await verifySessionToken(SECRET, token)).toBeNull()
  })

  it("reject a token whose payload was edited — no becoming someone else", async () => {
    const token = await createSessionToken(SECRET, USER)
    const [, signature] = token.split(".")

    // Same signature, payload swapped to another user's id.
    const forged = Buffer.from(
      JSON.stringify({ v: 2, typ: "session", uid: "someone-else", email: USER.email, exp: 4102444800 })
    ).toString("base64url")
    expect(await verifySessionToken(SECRET, `${forged}.${signature}`)).toBeNull()

    // And the reverse: original payload, signature from elsewhere.
    const [payload] = token.split(".")
    const otherSignature = (await createSessionToken("other", USER)).split(".")[1]
    expect(await verifySessionToken(SECRET, `${payload}.${otherSignature}`)).toBeNull()
  })

  it("reject an expired token", async () => {
    const issuedAt = Date.now()
    const token = await createSessionToken(SECRET, USER, issuedAt)

    const justBefore = issuedAt + SESSION_TTL_SECONDS * 1000 - 1000
    const justAfter = issuedAt + SESSION_TTL_SECONDS * 1000 + 1000

    expect(await verifySessionToken(SECRET, token, justBefore)).toEqual(USER)
    expect(await verifySessionToken(SECRET, token, justAfter)).toBeNull()
  })

  it("reject a validly-signed v1 token from the old password login", async () => {
    // Those named no user. Accepting one would mean guessing whose data to show.
    expect(await verifySessionToken(SECRET, rawToken({ v: 1, exp: 4102444800 }))).toBeNull()
    expect(
      await verifySessionToken(SECRET, rawToken({ v: 1, typ: "session", exp: 4102444800 }))
    ).toBeNull()
  })

  it("reject a validly-signed token with no user id or no email", async () => {
    const base = { v: 2, typ: "session", exp: 4102444800 }
    for (const payload of [
      { ...base, email: "a@b.c" },
      { ...base, uid: "", email: "a@b.c" },
      { ...base, uid: 42, email: "a@b.c" },
      { ...base, uid: "u" },
      { ...base, uid: "u", email: "" },
    ]) {
      expect(await verifySessionToken(SECRET, rawToken(payload)), JSON.stringify(payload)).toBeNull()
    }
  })

  it("reject a token of the wrong type — the OAuth state cookie is not a session", async () => {
    // Both are signed with AUTH_SECRET. Without the type check, an oauth
    // token that happened to carry a uid would be a valid session.
    const oauth = await signToken(SECRET, "oauth", { v: 2, uid: USER.userId, email: USER.email }, 600)
    expect(await verifySessionToken(SECRET, oauth)).toBeNull()

    const session = await createSessionToken(SECRET, USER)
    expect(await verifyToken(SECRET, "oauth", session)).toBeNull()
  })

  it("reject malformed input instead of throwing", async () => {
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
      expect(await verifySessionToken(SECRET, value), JSON.stringify(value)).toBeNull()
    }
  })

  it("reject a validly-signed token whose payload is not a JSON object", async () => {
    for (const payload of ["not json at all", "null", "42", '"string"']) {
      expect(await verifySessionToken(SECRET, rawToken(payload)), payload).toBeNull()
    }
  })

  it("reject a validly-signed token with no expiry", async () => {
    expect(
      await verifySessionToken(SECRET, rawToken({ v: 2, typ: "session", uid: "u", email: "a@b.c" }))
    ).toBeNull()
  })
})

describe("authenticate", () => {
  it("applies the allowlist to a valid session", async () => {
    const token = await createSessionToken(SECRET, USER)

    expect(await authenticate({ secret: SECRET, allowedEmails: "*" }, token)).toEqual(USER)
    expect(
      await authenticate({ secret: SECRET, allowedEmails: new Set(["me@example.com"]) }, token)
    ).toEqual(USER)
    expect(
      await authenticate({ secret: SECRET, allowedEmails: new Set(["other@example.com"]) }, token)
    ).toBeNull()
  })
})

describe("the allowlist", () => {
  it("parses comma- and whitespace-separated addresses, case-insensitively", () => {
    expect(parseAllowedEmails("A@x.com, b@Y.com  c@z.com\n")).toEqual(
      new Set(["a@x.com", "b@y.com", "c@z.com"])
    )
  })

  it("treats `*` as anyone, and nothing else as anyone", () => {
    expect(parseAllowedEmails("*")).toBe("*")
    expect(parseAllowedEmails(" * ")).toBe("*")
    // A `*` inside a list is not a wildcard.
    expect(parseAllowedEmails("a@x.com,*")).toEqual(new Set(["a@x.com", "*"]))
    expect(isEmailAllowed("anyone@x.com", parseAllowedEmails("a@x.com,*")!)).toBe(false)
  })

  it("is missing — not 'allow everyone' — when unset or empty", () => {
    expect(parseAllowedEmails(undefined)).toBeNull()
    expect(parseAllowedEmails("")).toBeNull()
    expect(parseAllowedEmails(" , ,")).toBeNull()
  })

  it("matches whole addresses only", () => {
    const allowed = parseAllowedEmails("me@gmail.com")!
    expect(isEmailAllowed("ME@gmail.com", allowed)).toBe(true)
    expect(isEmailAllowed("me@gmail.com.evil.com", allowed)).toBe(false)
    expect(isEmailAllowed("notme@gmail.com", allowed)).toBe(false)
  })
})

describe("configuration", () => {
  const original = { ...process.env }

  beforeEach(() => {
    for (const key of [
      "AUTH_SECRET",
      "AUTH_ALLOWED_EMAILS",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "AUTH_URL",
      "AUTH_COOKIE_SECURE",
    ]) {
      delete process.env[key]
    }
  })

  afterEach(() => {
    process.env = { ...original }
  })

  it("names exactly what is missing", () => {
    const none = readSessionConfig()
    expect(none.ok).toBe(false)
    expect(none.ok === false && none.reason).toContain("AUTH_SECRET")
    expect(none.ok === false && none.reason).toContain("AUTH_ALLOWED_EMAILS")

    process.env.AUTH_SECRET = "s"
    const one = readSessionConfig()
    expect(one.ok === false && one.reason).toContain("AUTH_ALLOWED_EMAILS")
    expect(one.ok === false && one.reason).not.toContain("AUTH_SECRET")

    const google = readGoogleConfig()
    for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "AUTH_URL"]) {
      expect(google.ok === false && google.reason).toContain(key)
    }
  })

  it("is satisfied only when everything is present", () => {
    process.env.AUTH_SECRET = "s"
    process.env.AUTH_ALLOWED_EMAILS = "a@b.c"
    expect(readSessionConfig().ok).toBe(true)
  })

  it("treats an empty secret as missing, not as configured", () => {
    // An empty AUTH_SECRET would sign tokens anyone could forge.
    process.env.AUTH_SECRET = ""
    process.env.AUTH_ALLOWED_EMAILS = "*"
    expect(readSessionConfig().ok).toBe(false)
  })

  it("reduces AUTH_URL to its origin, so the redirect_uri matches what Google has", () => {
    process.env.GOOGLE_CLIENT_ID = "id"
    process.env.GOOGLE_CLIENT_SECRET = "secret"

    process.env.AUTH_URL = "https://nas.example.ts.net/"
    const withSlash = readGoogleConfig()
    expect(withSlash.ok && withSlash.config.appUrl).toBe("https://nas.example.ts.net")

    process.env.AUTH_URL = "not a url"
    expect(readGoogleConfig().ok).toBe(false)

    process.env.AUTH_URL = "javascript:alert(1)"
    expect(readGoogleConfig().ok).toBe(false)
  })

  it("marks cookies Secure when AUTH_URL is https, unless overridden", () => {
    process.env.AUTH_URL = "http://localhost:3000"
    expect(sessionCookieOptions().secure).toBe(false)

    process.env.AUTH_URL = "https://nas.example.ts.net"
    expect(sessionCookieOptions().secure).toBe(true)

    process.env.AUTH_COOKIE_SECURE = "false"
    expect(sessionCookieOptions().secure).toBe(false)

    process.env.AUTH_URL = "http://localhost:3000"
    process.env.AUTH_COOKIE_SECURE = "true"
    expect(sessionCookieOptions().secure).toBe(true)
  })

  it("sets the session cookie HttpOnly and SameSite=Lax", () => {
    const options = sessionCookieOptions()
    expect(options.httpOnly).toBe(true)
    expect(options.sameSite).toBe("lax")
    expect(options.path).toBe("/")
    expect(options.maxAge).toBe(SESSION_TTL_SECONDS)
  })
})

describe("safeRedirectPath", () => {
  it("keeps same-origin paths", () => {
    expect(safeRedirectPath("/")).toBe("/")
    expect(safeRedirectPath("/history")).toBe("/history")
    expect(safeRedirectPath("/history?month=3&year=2026")).toBe("/history?month=3&year=2026")
  })

  it("refuses anything a browser would send to another host", () => {
    for (const value of [
      null,
      undefined,
      "",
      "history",
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "javascript:alert(1)",
    ]) {
      expect(safeRedirectPath(value), JSON.stringify(value)).toBe("/")
    }
  })
})

describe("Google ID token claims", () => {
  const NOW = 1_800_000_000_000
  const EXPECTED = { clientId: "client-123", nonce: "nonce-abc" }
  const GOOD = {
    iss: "https://accounts.google.com",
    aud: "client-123",
    exp: NOW / 1000 + 3600,
    nonce: "nonce-abc",
    sub: "1234567890",
    email: "Person@Gmail.com",
    email_verified: true,
    name: "A Person",
  }

  function codeFor(claims: Record<string, unknown>): string | null {
    try {
      validateIdTokenClaims(claims, EXPECTED, NOW)
      return null
    } catch (error) {
      return error instanceof SignInError ? error.code : "threw something else"
    }
  }

  it("accepts a good token and lowercases the email", () => {
    expect(validateIdTokenClaims(GOOD, EXPECTED, NOW)).toEqual({
      sub: "1234567890",
      email: "person@gmail.com",
      name: "A Person",
    })
  })

  it("accepts both documented issuer forms, and the legacy string email_verified", () => {
    expect(codeFor({ ...GOOD, iss: "accounts.google.com" })).toBeNull()
    expect(codeFor({ ...GOOD, email_verified: "true" })).toBeNull()
  })

  it("rejects every claim that says the token is not for this sign-in", () => {
    for (const [label, claims] of [
      ["wrong issuer", { ...GOOD, iss: "https://evil.example" }],
      ["missing issuer", { ...GOOD, iss: undefined }],
      ["wrong audience", { ...GOOD, aud: "someone-else" }],
      ["audience list naming another party too", { ...GOOD, aud: ["client-123", "someone-else"] }],
      ["expired", { ...GOOD, exp: NOW / 1000 - 120 }],
      ["no expiry", { ...GOOD, exp: undefined }],
      ["wrong nonce", { ...GOOD, nonce: "other" }],
      ["no nonce", { ...GOOD, nonce: undefined }],
      ["no subject", { ...GOOD, sub: "" }],
      ["no email", { ...GOOD, email: undefined }],
    ] as const) {
      expect(codeFor(claims as Record<string, unknown>), label).toBe("failed")
    }
  })

  it("tolerates a minute of clock skew on expiry, and no more", () => {
    expect(codeFor({ ...GOOD, exp: NOW / 1000 - 30 })).toBeNull()
    expect(codeFor({ ...GOOD, exp: NOW / 1000 - 90 })).toBe("failed")
  })

  it("rejects an unverified email with its own code", () => {
    for (const value of [false, "false", undefined, null, 1]) {
      expect(codeFor({ ...GOOD, email_verified: value }), String(value)).toBe("unverified")
    }
  })

  it("accepts a single-element audience list naming us", () => {
    expect(codeFor({ ...GOOD, aud: ["client-123"] })).toBeNull()
  })

  it("decodes a JWT payload and refuses anything that is not one", () => {
    const payload = Buffer.from(JSON.stringify({ a: 1 })).toString("base64url")
    expect(decodeJwtPayload(`h.${payload}.s`)).toEqual({ a: 1 })

    for (const value of ["", "a.b", "a.b.c.d", `h.${Buffer.from("[1]").toString("base64url")}x.s`, "h.!!!.s"]) {
      expect(decodeJwtPayload(value), value).toBeNull()
    }
  })
})

describe("login error codes", () => {
  it("maps known codes and falls back to a generic message for anything else", () => {
    expect(loginErrorMessage("not_allowed")).toMatch(/not allowed/i)
    expect(loginErrorMessage("<script>")).toBe(loginErrorMessage("failed"))
    expect(loginErrorMessage("__proto__")).toBe(loginErrorMessage("failed"))
    expect(loginErrorMessage(null)).toBeNull()
  })
})
