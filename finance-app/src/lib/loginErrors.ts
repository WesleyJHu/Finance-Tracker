/**
 * Why a sign-in did not complete, as the short code the auth routes put in
 * `/login?error=` and the message the login page shows for it.
 *
 * The code travels in a URL, so it describes what the person can do about it
 * and nothing about the internals. The detail is logged server side.
 */
export const LOGIN_ERRORS = {
  // Google sent the user back with ?error=access_denied: they hit Cancel.
  cancelled: "Sign-in was cancelled.",
  // The state cookie was missing, expired, or did not match. Usually a
  // sign-in tab left open for over ten minutes, or started on another host.
  expired: "That sign-in attempt expired. Please try again.",
  not_allowed: "That Google account is not allowed to use this tracker. Ask the owner to add it.",
  unverified: "Google has not verified that account's email address.",
  conflict:
    "That email address is already linked to a different Google account.",
  not_configured: "Google sign-in is not configured on the server.",
  failed: "Sign-in failed. Please try again.",
} as const

export type LoginErrorCode = keyof typeof LOGIN_ERRORS

export function loginErrorMessage(code: string | undefined | null): string | null {
  if (!code) return null
  return Object.hasOwn(LOGIN_ERRORS, code)
    ? LOGIN_ERRORS[code as LoginErrorCode]
    : LOGIN_ERRORS.failed
}
