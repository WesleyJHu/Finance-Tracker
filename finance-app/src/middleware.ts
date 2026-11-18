import { NextRequest, NextResponse } from "next/server"
import { SESSION_COOKIE, authenticate, readGoogleConfig, readSessionConfig } from "@/lib/auth"

/**
 * Gates the whole app behind a Google sign-in.
 *
 * Runs on the Edge runtime, so it may only use Web Crypto — see the note at
 * the top of src/lib/auth.ts.
 *
 * This is the outer wall, not the only one. Every route handler resolves the
 * user from the cookie again itself (src/lib/session.ts) and scopes every
 * query to them; this file decides only whether a request gets in at all.
 *
 * Fail-closed: a missing AUTH_SECRET or AUTH_ALLOWED_EMAILS refuses every
 * request instead of serving anything.
 */

/** Reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/google",
  "/api/auth/google/callback",
  "/api/auth/logout",
  // The container's HEALTHCHECK runs before any login and has no cookie. It
  // returns only {"status":"ok"} — no data, nothing about the internals.
  "/api/health",
])

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname)
}

function unauthorized(req: NextRequest): NextResponse {
  // An API call gets a status it can act on; a page navigation gets sent to
  // the login page. Redirecting fetch() to HTML would surface as a JSON parse
  // error rather than "you are logged out".
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  // To the login page on AUTH_URL's host, not the host this request arrived
  // on. A session cookie only ever exists on AUTH_URL's host — that is where
  // Google redirects back to — so someone reaching the app some other way
  // (the NAS's bare Tailscale IP, say) could never stay signed in there.
  // Sending them to the canonical address makes the old bookmark still work.
  const google = readGoogleConfig()
  const loginUrl = new URL("/login", google.ok ? google.config.appUrl : req.url)
  // Only the path and query, never an absolute URL from user input, so this
  // cannot be turned into an open redirect to another host.
  const target = req.nextUrl.pathname + req.nextUrl.search
  if (target !== "/") loginUrl.searchParams.set("next", target)

  return NextResponse.redirect(loginUrl)
}

export async function middleware(req: NextRequest) {
  if (isPublic(req.nextUrl.pathname)) return NextResponse.next()

  const config = readSessionConfig()
  if (!config.ok) {
    console.error(`Auth is not configured: ${config.reason}`)
    return NextResponse.json({ error: "Server is not configured for authentication" }, { status: 503 })
  }

  // Verifies the signature and expiry, and that the session's email is still
  // in AUTH_ALLOWED_EMAILS — so removing someone takes effect on restart, not
  // when their 30-day cookie runs out.
  if (!(await authenticate(config.config, req.cookies.get(SESSION_COOKIE)?.value))) {
    return unauthorized(req)
  }

  return NextResponse.next()
}

export const config = {
  /**
   * Everything except Next's own build output and static files.
   *
   * The API routes are deliberately included: leaving them out would leave
   * every endpoint open while only the pages were protected, which is the
   * usual way this kind of gate ends up decorative.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg$|.*\\.png$|.*\\.ico$).*)"],
}
