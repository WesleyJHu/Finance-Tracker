import { NextResponse } from "next/server"
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth"

export const runtime = "nodejs"

/**
 * Clears the session cookie.
 *
 * The session is a signed token rather than a database row, so this is the
 * only place a logout happens: the token itself stays technically valid until
 * it expires. To invalidate every outstanding session at once — a stolen
 * laptop, say — rotate AUTH_SECRET and restart.
 */
export async function POST() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(0), maxAge: 0 })
  return response
}
