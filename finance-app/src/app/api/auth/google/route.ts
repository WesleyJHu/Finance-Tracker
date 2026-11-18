import { NextRequest, NextResponse } from "next/server"
import { readGoogleConfig, readSessionConfig, safeRedirectPath, signToken } from "@/lib/auth"
import { buildAuthorizeUrl, randomToken } from "@/lib/google"
import { OAUTH_COOKIE, OAUTH_TTL_SECONDS, oauthCookieOptions } from "./oauthCookie"

export const runtime = "nodejs"
// Every response carries fresh random values; a cached one would replay them.
export const dynamic = "force-dynamic"

/**
 * Starts a Google sign-in: GET /api/auth/google?next=/history
 *
 * The login page links here with an absolute URL built from AUTH_URL, so the
 * state cookie is always set on the same host Google will redirect back to.
 * Starting on another host (the NAS's LAN address, say) would set it where
 * the callback can never read it.
 */
export async function GET(req: NextRequest) {
  const session = readSessionConfig()
  const google = readGoogleConfig()

  if (!session.ok || !google.ok) {
    console.error(
      `Google sign-in is not configured: ${[session, google]
        .map((result) => (result.ok ? null : result.reason))
        .filter(Boolean)
        .join(" ")}`
    )
    const base = google.ok ? google.config.appUrl : req.url
    return NextResponse.redirect(new URL("/login?error=not_configured", base))
  }

  const attempt = {
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(),
    next: safeRedirectPath(req.nextUrl.searchParams.get("next")),
  }

  const authorizeUrl = await buildAuthorizeUrl({
    clientId: google.config.clientId,
    appUrl: google.config.appUrl,
    state: attempt.state,
    nonce: attempt.nonce,
    codeVerifier: attempt.verifier,
  })

  const response = NextResponse.redirect(authorizeUrl)
  response.cookies.set(
    OAUTH_COOKIE,
    await signToken(session.config.secret, "oauth", attempt, OAUTH_TTL_SECONDS),
    oauthCookieOptions()
  )
  response.headers.set("Cache-Control", "no-store")
  return response
}
