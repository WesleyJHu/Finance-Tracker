import { NextRequest, NextResponse } from "next/server"
import {
  SESSION_COOKIE,
  authDisabled,
  createSessionToken,
  readAuthConfig,
  sessionCookieOptions,
} from "@/lib/auth"
import { verifyPassword } from "@/lib/password"

// Node, not Edge: scrypt is node:crypto.
export const runtime = "nodejs"

/**
 * A crude throttle on repeated failures.
 *
 * In memory, so it resets on restart and does not span replicas — neither
 * matters for one container on a LAN. The point is to make an online guessing
 * attack take days rather than minutes; offline resistance is scrypt's job.
 */
const MAX_ATTEMPTS = 10
const LOCKOUT_MS = 15 * 60 * 1000

const failures = new Map<string, { count: number; firstAt: number }>()

function clientKey(req: NextRequest): string {
  // Behind a reverse proxy the socket address is the proxy's, so prefer the
  // forwarded address when one is present. Spoofable, which is why this is a
  // speed bump and not an access control.
  const forwarded = req.headers.get("x-forwarded-for")
  return forwarded?.split(",")[0].trim() || "unknown"
}

function lockedOut(key: string): boolean {
  const entry = failures.get(key)
  if (!entry) return false
  if (Date.now() - entry.firstAt > LOCKOUT_MS) {
    failures.delete(key)
    return false
  }
  return entry.count >= MAX_ATTEMPTS
}

function recordFailure(key: string) {
  const entry = failures.get(key)
  if (!entry || Date.now() - entry.firstAt > LOCKOUT_MS) {
    failures.set(key, { count: 1, firstAt: Date.now() })
    return
  }
  entry.count++
}

export async function POST(req: NextRequest) {
  if (authDisabled()) {
    return NextResponse.json({ error: "Authentication is disabled" }, { status: 400 })
  }

  const auth = readAuthConfig()
  if (!auth.ok) {
    console.error(`Auth is not configured: ${auth.reason}`)
    return NextResponse.json({ error: "Server is not configured for authentication" }, { status: 503 })
  }

  const key = clientKey(req)
  if (lockedOut(key)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in 15 minutes." },
      { status: 429 }
    )
  }

  let password: unknown
  try {
    password = (await req.json())?.password
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  if (typeof password !== "string" || password.length === 0) {
    recordFailure(key)
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 })
  }

  if (!(await verifyPassword(password, auth.config.passwordHash))) {
    recordFailure(key)
    // Deliberately the same message and status as a missing password: nothing
    // here should distinguish "wrong password" from anything else.
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 })
  }

  failures.delete(key)

  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, await createSessionToken(auth.config.secret), sessionCookieOptions())
  return response
}
