import { NextRequest, NextResponse } from "next/server"
import {
  SESSION_COOKIE,
  createSessionToken,
  isEmailAllowed,
  readGoogleConfig,
  readSessionConfig,
  safeRedirectPath,
  sessionCookieOptions,
  verifyToken,
} from "@/lib/auth"
import { SignInError, exchangeCode } from "@/lib/google"
import { signInWithGoogle } from "@/lib/users"
import type { LoginErrorCode } from "@/lib/loginErrors"
import { OAUTH_COOKIE, oauthCookieOptions, readAttempt } from "../oauthCookie"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Where Google sends the browser back to:
 * GET /api/auth/google/callback?code=...&state=...
 *
 * Must be registered, exactly, as an authorized redirect URI in the Google
 * Cloud console: `${AUTH_URL}/api/auth/google/callback`.
 *
 * Every outcome is a redirect — to the destination with a session cookie, or
 * to /login with an error code — and every outcome clears the state cookie,
 * so an attempt can be used at most once.
 */
export async function GET(req: NextRequest) {
  const session = readSessionConfig()
  const google = readGoogleConfig()

  if (!session.ok || !google.ok) {
    const base = google.ok ? google.config.appUrl : req.url
    return NextResponse.redirect(new URL("/login?error=not_configured", base))
  }

  const { appUrl } = google.config

  function finish(destination: string): NextResponse {
    const response = NextResponse.redirect(new URL(destination, appUrl))
    response.cookies.set(OAUTH_COOKIE, "", { ...oauthCookieOptions(0), maxAge: 0 })
    response.headers.set("Cache-Control", "no-store")
    return response
  }

  function fail(code: LoginErrorCode, detail?: string): NextResponse {
    if (detail) console.warn(`Google sign-in refused (${code}): ${detail}`)
    return finish(`/login?error=${code}`)
  }

  const params = req.nextUrl.searchParams

  // Google reports a refusal on the consent screen as ?error=, with no code.
  const googleError = params.get("error")
  if (googleError) {
    return googleError === "access_denied"
      ? fail("cancelled")
      : fail("failed", `Google returned error=${googleError}`)
  }

  const attempt = readAttempt(
    await verifyToken(session.config.secret, "oauth", req.cookies.get(OAUTH_COOKIE)?.value)
  )

  // No attempt cookie, or one that does not match: an expired tab, a sign-in
  // started on a different host than AUTH_URL, or a forged callback (login
  // CSRF, which is what `state` exists to stop). All look the same from here.
  const state = params.get("state")
  const code = params.get("code")
  if (!attempt || !state || state !== attempt.state) {
    return fail("expired", attempt ? "state mismatch" : "no valid state cookie")
  }
  if (!code) {
    return fail("failed", "callback had no code")
  }

  try {
    const identity = await exchangeCode({
      clientId: google.config.clientId,
      clientSecret: google.config.clientSecret,
      appUrl,
      code,
      codeVerifier: attempt.verifier,
      nonce: attempt.nonce,
    })

    // Before any database write, so someone who is not allowed in does not
    // get a users row (or provisioned budgets) for having tried.
    if (!isEmailAllowed(identity.email, session.config.allowedEmails)) {
      return fail("not_allowed", `${identity.email} is not in AUTH_ALLOWED_EMAILS`)
    }

    const user = await signInWithGoogle(identity)

    const response = finish(safeRedirectPath(attempt.next))
    response.cookies.set(
      SESSION_COOKIE,
      await createSessionToken(session.config.secret, user),
      sessionCookieOptions()
    )
    return response
  } catch (error) {
    if (error instanceof SignInError) {
      return fail(error.code, error.message)
    }
    console.error("Google sign-in failed:", error)
    return fail("failed")
  }
}
