/**
 * The short-lived cookie that carries one sign-in attempt from
 * /api/auth/google to its callback: the `state` and `nonce` sent to Google,
 * the PKCE verifier, and where to go afterwards.
 *
 * Signed with AUTH_SECRET as an "oauth" token, which verifyToken will never
 * accept as a session (see `typ` in src/lib/auth.ts). Scoped to the two auth
 * routes, so it is not sent with every API request for its ten minutes.
 */
import { cookieSecure } from "@/lib/auth"

export const OAUTH_COOKIE = "finance_oauth"

/** How long the Google consent screen may sit open before the attempt lapses. */
export const OAUTH_TTL_SECONDS = 10 * 60

export type OAuthAttempt = {
  state: string
  nonce: string
  verifier: string
  next: string
}

export function oauthCookieOptions(maxAge: number = OAUTH_TTL_SECONDS) {
  return {
    httpOnly: true,
    // Lax is the strictest setting that still works: the callback is a
    // top-level navigation from accounts.google.com, which Strict would strip
    // the cookie from.
    sameSite: "lax" as const,
    path: "/api/auth/google",
    secure: cookieSecure(),
    maxAge,
  }
}

export function readAttempt(payload: Record<string, unknown> | null): OAuthAttempt | null {
  if (!payload) return null
  const { state, nonce, verifier, next } = payload
  if (
    typeof state !== "string" ||
    typeof nonce !== "string" ||
    typeof verifier !== "string" ||
    typeof next !== "string"
  ) {
    return null
  }
  return { state, nonce, verifier, next }
}
