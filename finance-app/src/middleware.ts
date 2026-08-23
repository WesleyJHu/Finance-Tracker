import { NextRequest, NextResponse } from "next/server"
import { SESSION_COOKIE, authDisabled, readAuthConfig, verifySessionToken } from "@/lib/auth"

/**
 * Gates the whole app behind one session cookie.
 *
 * Runs on the Edge runtime, so it may only use Web Crypto — see the note at
 * the top of src/lib/auth.ts.
 *
 * Fail-closed: a missing AUTH_SECRET or AUTH_PASSWORD_HASH refuses every
 * request instead of serving the dashboard unauthenticated. Set
 * AUTH_DISABLED=true to run without a login deliberately.
 */

/** Reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
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
  // the login form. Redirecting fetch() to HTML would surface as a JSON parse
  // error rather than "you are logged out".
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const loginUrl = new URL("/login", req.url)
  // Only the path and query, never an absolute URL from user input, so this
  // cannot be turned into an open redirect to another host.
  const target = req.nextUrl.pathname + req.nextUrl.search
  if (target !== "/") loginUrl.searchParams.set("next", target)

  return NextResponse.redirect(loginUrl)
}

export async function middleware(req: NextRequest) {
  if (authDisabled()) return NextResponse.next()
  if (isPublic(req.nextUrl.pathname)) return NextResponse.next()

  const auth = readAuthConfig()
  if (!auth.ok) {
    console.error(`Auth is not configured: ${auth.reason}`)
    return NextResponse.json({ error: "Server is not configured for authentication" }, { status: 503 })
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (!(await verifySessionToken(auth.config.secret, token))) {
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
