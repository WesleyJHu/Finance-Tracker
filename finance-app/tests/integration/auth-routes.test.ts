/**
 * The login and logout routes.
 *
 * Uses the integration harness rather than tests/unit because these import
 * route modules, which pull in the Next server runtime. No database is
 * touched.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth"
import { hashPassword } from "@/lib/password"

const PASSWORD = "a-good-enough-test-password"
const SECRET = "test-secret"

const originalEnv = { ...process.env }

beforeAll(async () => {
  process.env.AUTH_SECRET = SECRET
  process.env.AUTH_PASSWORD_HASH = await hashPassword(PASSWORD)
  delete process.env.AUTH_DISABLED
}, 60_000)

afterAll(() => {
  process.env = { ...originalEnv }
})

/**
 * Each test gets its own module instance, because the login route keeps its
 * failure counter in module scope — sharing one would let the lockout test
 * leak into the others.
 */
async function freshLogin() {
  vi.resetModules()
  return (await import("@/app/api/auth/login/route")).POST
}

function request(body: unknown, ip = "10.0.0.1") {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

describe("POST /api/auth/login", () => {
  it("sets a valid session cookie for the right password", async () => {
    const POST = await freshLogin()
    const res = await POST(request({ password: PASSWORD }))

    expect(res.status).toBe(200)

    const cookie = res.cookies.get(SESSION_COOKIE)
    expect(cookie).toBeDefined()
    expect(await verifySessionToken(SECRET, cookie!.value)).toBe(true)
  }, 30_000)

  it("sets the cookie HttpOnly, so script on the page cannot read it", async () => {
    const POST = await freshLogin()
    const res = await POST(request({ password: PASSWORD }))

    const cookie = res.cookies.get(SESSION_COOKIE)!
    expect(cookie.httpOnly).toBe(true)
    expect(cookie.sameSite).toBe("lax")
    expect(cookie.path).toBe("/")
  }, 30_000)

  it("401s on the wrong password and sets no cookie", async () => {
    const POST = await freshLogin()
    const res = await POST(request({ password: "wrong" }))

    expect(res.status).toBe(401)
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined()
  }, 30_000)

  it("gives the same answer for a wrong password, a missing one, and a blank one", async () => {
    // Nothing in the response should tell an attacker which part was wrong.
    const bodies = [{ password: "wrong" }, {}, { password: "" }, { password: 123 }]
    const seen = new Set<string>()

    for (const body of bodies) {
      const POST = await freshLogin()
      const res = await POST(request(body))
      seen.add(`${res.status}:${JSON.stringify(await res.json())}`)
    }

    expect(seen.size).toBe(1)
  }, 60_000)

  it("400s on a body that is not JSON, without leaking a parser error", async () => {
    const POST = await freshLogin()
    const res = await POST(request("{not json"))

    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).not.toMatch(/JSON|parse|unexpected/i)
  }, 30_000)

  it("locks out after repeated failures, and the lockout survives a correct password", async () => {
    const POST = await freshLogin()

    for (let i = 0; i < 10; i++) {
      expect((await POST(request({ password: "wrong" }))).status).toBe(401)
    }

    expect((await POST(request({ password: "wrong" }))).status).toBe(429)

    // The whole point: knowing the password does not get you past the lockout.
    const afterLockout = await POST(request({ password: PASSWORD }))
    expect(afterLockout.status).toBe(429)
    expect(afterLockout.cookies.get(SESSION_COOKIE)).toBeUndefined()
  }, 60_000)

  it("locks out one client without affecting another", async () => {
    const POST = await freshLogin()

    for (let i = 0; i < 10; i++) await POST(request({ password: "wrong" }, "10.0.0.1"))

    expect((await POST(request({ password: PASSWORD }, "10.0.0.1"))).status).toBe(429)
    expect((await POST(request({ password: PASSWORD }, "10.0.0.2"))).status).toBe(200)
  }, 60_000)

  it("clears the failure count after a successful login", async () => {
    const POST = await freshLogin()

    for (let i = 0; i < 9; i++) await POST(request({ password: "wrong" }))
    expect((await POST(request({ password: PASSWORD }))).status).toBe(200)

    // Back to a full budget of attempts rather than one away from lockout.
    for (let i = 0; i < 10; i++) {
      expect((await POST(request({ password: "wrong" }))).status).toBe(401)
    }
  }, 90_000)

  it("503s rather than letting anyone in when it is not configured", async () => {
    const saved = process.env.AUTH_PASSWORD_HASH
    delete process.env.AUTH_PASSWORD_HASH
    try {
      const POST = await freshLogin()
      const res = await POST(request({ password: PASSWORD }))

      expect(res.status).toBe(503)
      expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined()
    } finally {
      process.env.AUTH_PASSWORD_HASH = saved
    }
  }, 30_000)
})

describe("POST /api/auth/logout", () => {
  it("expires the session cookie", async () => {
    vi.resetModules()
    const { POST } = await import("@/app/api/auth/logout/route")
    const res = await POST()

    expect(res.status).toBe(200)

    const cookie = res.cookies.get(SESSION_COOKIE)!
    expect(cookie.value).toBe("")
    expect(cookie.maxAge).toBe(0)
  })
})
