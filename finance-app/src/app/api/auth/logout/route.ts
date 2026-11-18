import { NextResponse } from "next/server"
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth"

export const runtime = "nodejs"

/**
 * Clears the session cookie.
 *
 * The session is a signed token rather than a database row, so this is the
 * only place a logout happens: the token itself stays technically valid until
 * it expires. To cut one person off everywhere, remove them from
 * AUTH_ALLOWED_EMAILS and restart — the allowlist is checked on every request.
 * To sign out everyone, rotate AUTH_SECRET and restart.
 *
 * This does not sign the browser out of Google, which would sign the person
 * out of Gmail too.
 */
export async function POST() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(0), maxAge: 0 })
  return response
}
