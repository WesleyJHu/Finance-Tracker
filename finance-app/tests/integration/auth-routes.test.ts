/**
 * Google sign-in, end to end through the route handlers, plus the middleware
 * and logout.
 *
 * Google itself is the one thing stubbed: `fetch` is replaced so the token
 * endpoint returns an ID token built here. Everything else — the state
 * cookie, PKCE, claim checks, user matching and provisioning, the session
 * cookie — is the real code against the real test database.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import { NextRequest } from "next/server"
import { pool } from "@/lib/db"
import {
  SESSION_COOKIE,
  createSessionToken,
  signToken,
  verifySessionToken,
  verifyToken,
} from "@/lib/auth"
import { GOOGLE_TOKEN_URL } from "@/lib/google"
import { signInWithGoogle } from "@/lib/users"
import { GET as start } from "@/app/api/auth/google/route"
import { GET as callback } from "@/app/api/auth/google/callback/route"
import { POST as logout } from "@/app/api/auth/logout/route"
import { GET as session } from "@/app/api/auth/session/route"
import { OAUTH_COOKIE } from "@/app/api/auth/google/oauthCookie"
import { middleware } from "@/middleware"
import { createAccount, createUser } from "./support/fixtures"
import { truncateAll } from "./support/database"
import { authed } from "./support/session"
import { todayInAppTz } from "@/lib/dates"

const APP_URL = "http://localhost:3000"
const SECRET = () => process.env.AUTH_SECRET as string
const CLIENT_ID = () => process.env.GOOGLE_CLIENT_ID as string

const savedEnv = { ...process.env }

beforeEach(async () => {
  await truncateAll(pool)
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...savedEnv }
})

afterAll(async () => {
  await pool.end()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function b64url(value: string): string {
  return Buffer.from(value).toString("base64url")
}

/** An unsigned JWT. The app does not verify the signature; see src/lib/google.ts. */
function fakeIdToken(claims: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}.c2ln`
}

type Attempt = { cookie: string; state: string; nonce: string; verifier: string; location: URL }

/** Runs the start route and returns what the browser would carry to Google and back. */
async function beginSignIn(next?: string): Promise<Attempt> {
  const url = `${APP_URL}/api/auth/google${next === undefined ? "" : `?next=${encodeURIComponent(next)}`}`
  const res = await start(new NextRequest(url))
  const cookie = res.cookies.get(OAUTH_COOKIE)?.value
  if (!cookie) throw new Error(`start route set no state cookie (status ${res.status})`)

  const payload = await verifyToken(SECRET(), "oauth", cookie)
  return {
    cookie,
    state: payload!.state as string,
    nonce: payload!.nonce as string,
    verifier: payload!.verifier as string,
    location: new URL(res.headers.get("location")!),
  }
}

type GoogleUser = { sub: string; email: string; name?: string; email_verified?: unknown }

/**
 * Stubs Google's token endpoint to sign in `user`, and records what it was
 * sent. `claims` overrides any ID token claim.
 */
function stubGoogle(
  user: GoogleUser,
  attempt: Pick<Attempt, "nonce">,
  { claims = {}, status = 200 }: { claims?: Record<string, unknown>; status?: number } = {}
) {
  const calls: { url: string; body: URLSearchParams }[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: new URLSearchParams(String(init.body)) })
      if (status !== 200) {
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status })
      }
      const idToken = fakeIdToken({
        iss: "https://accounts.google.com",
        aud: CLIENT_ID(),
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        nonce: attempt.nonce,
        sub: user.sub,
        email: user.email,
        email_verified: user.email_verified ?? true,
        name: user.name ?? "Test Person",
        ...claims,
      })
      return new Response(JSON.stringify({ id_token: idToken, access_token: "unused" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })
  )
  return calls
}

async function finishSignIn(
  attempt: Pick<Attempt, "cookie" | "state">,
  { code = "auth-code", state = attempt.state, cookie = attempt.cookie, extra = "" } = {}
) {
  const query = new URLSearchParams({ code, state })
  const res = await callback(
    new NextRequest(`${APP_URL}/api/auth/google/callback?${query}${extra}`, {
      headers: cookie ? { cookie: `${OAUTH_COOKIE}=${cookie}` } : {},
    })
  )
  const location = new URL(res.headers.get("location")!)
  const sessionValue = res.cookies.get(SESSION_COOKIE)?.value
  const sessionUser = sessionValue ? await verifySessionToken(SECRET(), sessionValue) : null
  return { res, location, sessionUser, oauthCookie: res.cookies.get(OAUTH_COOKIE) }
}

async function userCount(): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM users`)
  return rows[0].n
}

// ---------------------------------------------------------------------------
// GET /api/auth/google
// ---------------------------------------------------------------------------

describe("GET /api/auth/google", () => {
  it("redirects to Google with state, nonce and a PKCE S256 challenge", async () => {
    const attempt = await beginSignIn()
    const params = attempt.location.searchParams

    expect(attempt.location.origin + attempt.location.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    )
    expect(params.get("client_id")).toBe(CLIENT_ID())
    expect(params.get("redirect_uri")).toBe(`${APP_URL}/api/auth/google/callback`)
    expect(params.get("response_type")).toBe("code")
    expect(params.get("scope")).toBe("openid email profile")
    expect(params.get("state")).toBe(attempt.state)
    expect(params.get("nonce")).toBe(attempt.nonce)
    expect(params.get("code_challenge_method")).toBe("S256")
    expect(params.get("code_challenge")).toBe(
      createHash("sha256").update(attempt.verifier).digest("base64url")
    )

    // The verifier goes to Google only at the token exchange, never through
    // the browser's address bar.
    expect(attempt.location.toString()).not.toContain(attempt.verifier)
  })

  it("uses fresh random values every time", async () => {
    const a = await beginSignIn()
    const b = await beginSignIn()
    expect(a.state).not.toBe(b.state)
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.verifier).not.toBe(b.verifier)
  })

  it("sets the state cookie HttpOnly, Lax, short-lived and scoped to the auth routes", async () => {
    const res = await start(new NextRequest(`${APP_URL}/api/auth/google`))
    const cookie = res.cookies.get(OAUTH_COOKIE)!

    expect(cookie.httpOnly).toBe(true)
    expect(cookie.sameSite).toBe("lax")
    expect(cookie.path).toBe("/api/auth/google")
    expect(cookie.maxAge).toBe(600)
  })

  it("remembers a same-site `next` and discards one pointing elsewhere", async () => {
    expect((await verifyToken(SECRET(), "oauth", (await beginSignIn("/history?x=1")).cookie))!.next)
      .toBe("/history?x=1")

    for (const hostile of ["//evil.example", "https://evil.example", "/\\evil.example", "/\t/evil.example"]) {
      const payload = await verifyToken(SECRET(), "oauth", (await beginSignIn(hostile)).cookie)
      expect(payload!.next, hostile).toBe("/")
    }
  })

  it("sends the user back to the login page when Google is not configured", async () => {
    delete process.env.GOOGLE_CLIENT_SECRET
    const res = await start(new NextRequest(`${APP_URL}/api/auth/google`))

    expect(new URL(res.headers.get("location")!).pathname).toBe("/login")
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("not_configured")
    expect(res.cookies.get(OAUTH_COOKIE)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// GET /api/auth/google/callback
// ---------------------------------------------------------------------------

describe("GET /api/auth/google/callback — signing in", () => {
  it("creates a new user, with budgets and this month's snapshot, and signs them in", async () => {
    const attempt = await beginSignIn("/history")
    stubGoogle({ sub: "g-new", email: "New.Person@Example.com" }, attempt)

    const { location, sessionUser, oauthCookie } = await finishSignIn(attempt)

    expect(location.toString()).toBe(`${APP_URL}/history`)
    expect(sessionUser).not.toBeNull()
    // Stored and signed lowercased, so the allowlist and the unique key agree.
    expect(sessionUser!.email).toBe("new.person@example.com")

    const { rows } = await pool.query(`SELECT * FROM users`)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: sessionUser!.userId,
      google_sub: "g-new",
      email: "new.person@example.com",
      name: "Test Person",
    })

    const budgets = await pool.query(
      `SELECT month, base_budget::float8 AS base_budget FROM monthly_budgets WHERE user_id = $1 ORDER BY month`,
      [sessionUser!.userId]
    )
    expect(budgets.rows.map((row) => row.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(budgets.rows.every((row) => row.base_budget === 0)).toBe(true)

    const today = todayInAppTz()
    const snapshot = await pool.query(
      `SELECT starting_balance::float8 AS starting_balance FROM monthly_balance_snapshot
        WHERE user_id = $1 AND month = $2 AND year = $3`,
      [sessionUser!.userId, today.month, today.year]
    )
    expect(snapshot.rows).toEqual([{ starting_balance: 0 }])

    // Single use: the state cookie is cleared on the way out.
    expect(oauthCookie?.value).toBe("")
    expect(oauthCookie?.maxAge).toBe(0)
  })

  it("sends the code, PKCE verifier, client secret and exact redirect_uri to the token endpoint", async () => {
    const attempt = await beginSignIn()
    const calls = stubGoogle({ sub: "g-1", email: "a@example.com" }, attempt)

    await finishSignIn(attempt, { code: "the-code" })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(GOOGLE_TOKEN_URL)
    expect(Object.fromEntries(calls[0].body)).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      client_id: CLIENT_ID(),
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${APP_URL}/api/auth/google/callback`,
      code_verifier: attempt.verifier,
    })
  })

  it("signs a returning user into the same account, matched on sub", async () => {
    const first = await beginSignIn()
    stubGoogle({ sub: "g-same", email: "me@example.com" }, first)
    const one = await finishSignIn(first)

    // Same Google account, now with a different address on it.
    const second = await beginSignIn()
    stubGoogle({ sub: "g-same", email: "me-renamed@example.com", name: "Renamed" }, second)
    const two = await finishSignIn(second)

    expect(two.sessionUser!.userId).toBe(one.sessionUser!.userId)
    expect(await userCount()).toBe(1)

    const { rows } = await pool.query(`SELECT email, name, last_login_at FROM users`)
    expect(rows[0]).toMatchObject({ email: "me-renamed@example.com", name: "Renamed" })
    expect(rows[0].last_login_at).not.toBeNull()
  })

  it("links the pre-existing owner by verified email, keeping their data", async () => {
    // What db/migrations/0002_multi_user.sql leaves behind: the owner, with
    // all the old rows, and no google_sub yet.
    const owner = await createUser(pool, { email: "owner@example.com", googleSub: null })
    const account = await createAccount(pool, { userId: owner.id, name: "Checking", type: "Checking" })

    const attempt = await beginSignIn()
    stubGoogle({ sub: "g-owner", email: "Owner@Example.com" }, attempt)
    const { sessionUser } = await finishSignIn(attempt)

    expect(sessionUser!.userId).toBe(owner.id)
    expect(await userCount()).toBe(1)

    const { rows } = await pool.query(`SELECT google_sub FROM users WHERE id = $1`, [owner.id])
    expect(rows[0].google_sub).toBe("g-owner")

    // And the session reaches their existing data.
    const { GET } = await import("@/app/api/accounts/route")
    const res = await GET(await authed({ id: owner.id, email: "owner@example.com" }, `${APP_URL}/api/accounts`))
    expect((await res.json()).map((a: { id: string }) => a.id)).toEqual([account.id])
  })

  it("does not provision a second set of budgets for a linked owner", async () => {
    const owner = await createUser(pool, { email: "owner@example.com", googleSub: null })
    await pool.query(
      `INSERT INTO monthly_budgets (user_id, month, base_budget) VALUES ($1, 1, 1234)`,
      [owner.id]
    )

    const attempt = await beginSignIn()
    stubGoogle({ sub: "g-owner", email: "owner@example.com" }, attempt)
    await finishSignIn(attempt)

    const { rows } = await pool.query(
      `SELECT month, base_budget::float8 AS base_budget FROM monthly_budgets WHERE user_id = $1`,
      [owner.id]
    )
    expect(rows).toEqual([{ month: 1, base_budget: 1234 }])
  })

  it("survives two first sign-ins racing, leaving exactly one user", async () => {
    const identity = { sub: "g-race", email: "race@example.com", name: null }
    const [a, b] = await Promise.all([signInWithGoogle(identity), signInWithGoogle(identity)])

    expect(a.userId).toBe(b.userId)
    expect(await userCount()).toBe(1)
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM monthly_budgets`)
    expect(rows[0].n).toBe(12)
  })
})

describe("GET /api/auth/google/callback — refusing", () => {
  async function expectRefused(result: Awaited<ReturnType<typeof finishSignIn>>, code: string) {
    expect(result.location.pathname).toBe("/login")
    expect(result.location.searchParams.get("error")).toBe(code)
    expect(result.sessionUser).toBeNull()
    expect(result.res.cookies.get(SESSION_COOKIE)).toBeUndefined()
  }

  it("refuses an email that is not on the allowlist, before creating anything", async () => {
    process.env.AUTH_ALLOWED_EMAILS = "allowed@example.com, also-allowed@example.com"
    const attempt = await beginSignIn()
    stubGoogle({ sub: "g-x", email: "stranger@example.com" }, attempt)

    await expectRefused(await finishSignIn(attempt), "not_allowed")
    expect(await userCount()).toBe(0)
  })

  it("admits an allowlisted email regardless of case", async () => {
    process.env.AUTH_ALLOWED_EMAILS = "Allowed@Example.com"
    const attempt = await beginSignIn()
    stubGoogle({ sub: "g-ok", email: "allowed@EXAMPLE.com" }, attempt)

    expect((await finishSignIn(attempt)).sessionUser).not.toBeNull()
  })

  it("refuses an unverified email, so nobody can claim an address they do not own", async () => {
    await createUser(pool, { email: "owner@example.com", googleSub: null })
    const attempt = await beginSignIn()
    stubGoogle({ sub: "g-impostor", email: "owner@example.com", email_verified: false }, attempt)

    await expectRefused(await finishSignIn(attempt), "unverified")
    const { rows } = await pool.query(`SELECT google_sub FROM users`)
    expect(rows).toEqual([{ google_sub: null }])
  })

  it("refuses an email already linked to a different Google account", async () => {
    await createUser(pool, { email: "taken@example.com", googleSub: "g-original" })
    const attempt = await beginSignIn()
    stubGoogle({ sub: "g-newcomer", email: "taken@example.com" }, attempt)

    await expectRefused(await finishSignIn(attempt), "conflict")
    expect(await userCount()).toBe(1)
  })

  it("refuses a callback whose state does not match the cookie (login CSRF)", async () => {
    const attempt = await beginSignIn()
    const calls = stubGoogle({ sub: "g-1", email: "a@example.com" }, attempt)

    await expectRefused(await finishSignIn(attempt, { state: "attacker-chosen" }), "expired")
    // Refused before the code was spent.
    expect(calls).toHaveLength(0)
  })

  it("refuses a callback with no state cookie at all", async () => {
    const attempt = await beginSignIn()
    const calls = stubGoogle({ sub: "g-1", email: "a@example.com" }, attempt)

    await expectRefused(await finishSignIn(attempt, { cookie: "" }), "expired")
    expect(calls).toHaveLength(0)
  })

  it("refuses a state cookie that has expired", async () => {
    const attempt = await beginSignIn()
    const stale = await signToken(
      SECRET(),
      "oauth",
      { state: attempt.state, nonce: attempt.nonce, verifier: attempt.verifier, next: "/" },
      600,
      Date.now() - 11 * 60 * 1000
    )
    stubGoogle({ sub: "g-1", email: "a@example.com" }, attempt)

    await expectRefused(await finishSignIn(attempt, { cookie: stale }), "expired")
  })

  it("reports a cancelled consent screen as cancelled", async () => {
    const attempt = await beginSignIn()
    const res = await callback(
      new NextRequest(`${APP_URL}/api/auth/google/callback?error=access_denied&state=${attempt.state}`, {
        headers: { cookie: `${OAUTH_COOKIE}=${attempt.cookie}` },
      })
    )
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("cancelled")
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined()
  })

  it("refuses an ID token whose nonce is not this attempt's (replay)", async () => {
    const attempt = await beginSignIn()
    stubGoogle({ sub: "g-1", email: "a@example.com" }, attempt, { claims: { nonce: "someone-elses" } })
    await expectRefused(await finishSignIn(attempt), "failed")
  })

  it("refuses an ID token issued to a different client", async () => {
    const attempt = await beginSignIn()
    stubGoogle({ sub: "g-1", email: "a@example.com" }, attempt, { claims: { aud: "other-app" } })
    await expectRefused(await finishSignIn(attempt), "failed")
  })

  it("refuses an ID token from another issuer", async () => {
    const attempt = await beginSignIn()
    stubGoogle({ sub: "g-1", email: "a@example.com" }, attempt, { claims: { iss: "https://evil.example" } })
    await expectRefused(await finishSignIn(attempt), "failed")
  })

  it("refuses an expired ID token", async () => {
    const attempt = await beginSignIn()
    stubGoogle({ sub: "g-1", email: "a@example.com" }, attempt, {
      claims: { exp: Math.floor(Date.now() / 1000) - 3600 },
    })
    await expectRefused(await finishSignIn(attempt), "failed")
  })

  it("fails cleanly when Google rejects the code", async () => {
    const attempt = await beginSignIn()
    stubGoogle({ sub: "g-1", email: "a@example.com" }, attempt, { status: 400 })
    await expectRefused(await finishSignIn(attempt), "failed")
    expect(await userCount()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

describe("middleware", () => {
  const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1"

  async function withSession(path: string, token: string) {
    return middleware(
      new NextRequest(`${APP_URL}${path}`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } })
    )
  }

  it("lets a valid session through", async () => {
    const token = await createSessionToken(SECRET(), { userId: "u1", email: "a@example.com" })
    expect(passedThrough(await withSession("/api/accounts", token))).toBe(true)
  })

  it("401s an API call with no session, and redirects a page to /login with next=", async () => {
    const api = await middleware(new NextRequest(`${APP_URL}/api/accounts`))
    expect(api.status).toBe(401)

    const page = await middleware(new NextRequest(`${APP_URL}/history?tab=1`))
    const location = new URL(page.headers.get("location")!)
    expect(location.pathname).toBe("/login")
    expect(location.searchParams.get("next")).toBe("/history?tab=1")
  })

  it("sends a page visit on another host (the bare Tailscale IP) to AUTH_URL's login", async () => {
    const page = await middleware(new NextRequest("http://100.64.0.1:3000/history"))
    const location = new URL(page.headers.get("location")!)
    expect(location.origin).toBe(APP_URL)
    expect(location.pathname).toBe("/login")
    expect(location.searchParams.get("next")).toBe("/history")
  })

  it("leaves the sign-in routes, login page and health check public", async () => {
    for (const path of ["/login", "/api/auth/google", "/api/auth/google/callback", "/api/auth/logout", "/api/health"]) {
      expect(passedThrough(await middleware(new NextRequest(`${APP_URL}${path}`))), path).toBe(true)
    }
  })

  it("cuts off a session whose email has been removed from the allowlist", async () => {
    process.env.AUTH_ALLOWED_EMAILS = "a@example.com,b@example.com"
    const token = await createSessionToken(SECRET(), { userId: "u2", email: "b@example.com" })
    expect(passedThrough(await withSession("/api/accounts", token))).toBe(true)

    process.env.AUTH_ALLOWED_EMAILS = "a@example.com"
    expect((await withSession("/api/accounts", token)).status).toBe(401)
  })

  it("rejects a session from the old password login, which named no user", async () => {
    const legacy = await signToken(SECRET(), "session", { v: 1 }, 3600)
    expect((await withSession("/api/accounts", legacy)).status).toBe(401)
  })

  it("rejects the OAuth state cookie replayed as a session", async () => {
    const attempt = await beginSignIn()
    expect((await withSession("/api/accounts", attempt.cookie)).status).toBe(401)
  })

  it("503s every request rather than letting anyone in when not configured", async () => {
    const token = await createSessionToken(SECRET(), { userId: "u1", email: "a@example.com" })
    delete process.env.AUTH_ALLOWED_EMAILS
    expect((await withSession("/api/accounts", token)).status).toBe(503)
  })
})

// ---------------------------------------------------------------------------
// Session and logout
// ---------------------------------------------------------------------------

describe("GET /api/auth/session", () => {
  it("says who is signed in", async () => {
    const res = await session(await authed({ id: "u1", email: "who@example.com" }, `${APP_URL}/api/auth/session`))
    expect(await res.json()).toEqual({ email: "who@example.com" })
  })

  it("401s without a session", async () => {
    expect((await session(new NextRequest(`${APP_URL}/api/auth/session`))).status).toBe(401)
  })
})

describe("POST /api/auth/logout", () => {
  it("expires the session cookie", async () => {
    const res = await logout()

    expect(res.status).toBe(200)

    const cookie = res.cookies.get(SESSION_COOKIE)!
    expect(cookie.value).toBe("")
    expect(cookie.maxAge).toBe(0)
  })
})
