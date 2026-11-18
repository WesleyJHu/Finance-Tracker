/**
 * Google sign-in: the OpenID Connect authorization code flow, with PKCE.
 *
 *   1. /api/auth/google sends the browser to Google with a random `state`,
 *      `nonce` and PKCE challenge, and remembers all three in a signed,
 *      short-lived cookie.
 *   2. Google sends the browser back to /api/auth/google/callback with a code.
 *   3. The callback checks `state` against the cookie, then trades the code
 *      (plus the PKCE verifier and the client secret) for an ID token,
 *      server to server.
 *
 * No library: the flow is three HTTP requests and some claim checks, all of
 * which are below, and the app already has its own signed-cookie session.
 *
 * Why the ID token's signature is not verified against Google's JWKS: it is
 * received directly from Google's token endpoint over TLS, in response to a
 * request authenticated with our client secret, so it cannot have been
 * tampered with in between. OpenID Connect Core §3.1.3.7 allows TLS to stand
 * in for the signature check in exactly this case, and Google's own guide
 * says the same. The claims are still checked — iss, aud, exp and nonce —
 * because those are about whether the token is *for us, now*, not about
 * whether it is genuine.
 */
import { base64UrlDecode, base64UrlEncode } from "@/lib/auth"
import type { LoginErrorCode } from "@/lib/loginErrors"

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

/** Both forms are documented by Google as valid `iss` values. */
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"])

/** Tolerated clock difference between this host and Google, for `exp`. */
const CLOCK_SKEW_SECONDS = 60

export const CALLBACK_PATH = "/api/auth/google/callback"

export function redirectUri(appUrl: string): string {
  return `${appUrl}${CALLBACK_PATH}`
}

/** 32 random bytes, base64url: unguessable, and URL-safe as-is. */
export function randomToken(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
}

/** RFC 7636 S256: base64url(sha256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return base64UrlEncode(new Uint8Array(digest))
}

export async function buildAuthorizeUrl(params: {
  clientId: string
  appUrl: string
  state: string
  nonce: string
  codeVerifier: string
}): Promise<string> {
  const url = new URL(GOOGLE_AUTHORIZE_URL)
  url.search = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: redirectUri(params.appUrl),
    response_type: "code",
    // `email` for the allowlist and for matching the pre-existing owner;
    // `profile` for a display name. Nothing else: no Drive, no Gmail, no
    // offline access, so there is no refresh token to store or leak.
    scope: "openid email profile",
    state: params.state,
    nonce: params.nonce,
    code_challenge: await pkceChallenge(params.codeVerifier),
    code_challenge_method: "S256",
    // Shows the account chooser even with one Google session in the browser,
    // so signing out of this app and back in as someone else is possible.
    prompt: "select_account",
  }).toString()
  return url.toString()
}

/** The identity this app takes from a Google ID token. */
export type GoogleIdentity = {
  sub: string
  email: string
  name: string | null
}

/**
 * A refused sign-in. `code` is what the browser sees (see
 * src/lib/loginErrors.ts); `message` is the detail, which is only logged.
 */
export class SignInError extends Error {
  readonly code: LoginErrorCode

  constructor(code: LoginErrorCode, detail: string) {
    super(detail)
    this.name = "SignInError"
    this.code = code
  }
}

/** Decodes a JWT's payload without checking its signature. See the header. */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".")
  if (parts.length !== 3) return null
  const bytes = base64UrlDecode(parts[1])
  if (!bytes) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes))
    return typeof payload === "object" && payload !== null ? payload : null
  } catch {
    return null
  }
}

/**
 * Checks an ID token's claims and extracts the identity.
 *
 * Throws SignInError("failed") for anything that means the token is not for
 * this sign-in attempt, and SignInError("unverified") for a genuine Google
 * account whose email Google has not verified — matching on an unverified
 * email would let anyone claim the pre-existing owner's data by creating a
 * Google account with that address.
 */
export function validateIdTokenClaims(
  claims: Record<string, unknown>,
  expected: { clientId: string; nonce: string },
  now: number = Date.now()
): GoogleIdentity {
  if (typeof claims.iss !== "string" || !GOOGLE_ISSUERS.has(claims.iss)) {
    throw new SignInError("failed", `Unexpected issuer: ${String(claims.iss)}`)
  }

  // Google issues a single-string `aud`. An array is legal JWT, so accept it
  // only if our client id is in it and it names no one else.
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (audience.length !== 1 || audience[0] !== expected.clientId) {
    throw new SignInError("failed", "ID token was not issued to this client")
  }

  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS <= now / 1000) {
    throw new SignInError("failed", "ID token has expired")
  }

  // Binds the token to the browser that started this sign-in, so a token
  // obtained elsewhere cannot be replayed here.
  if (typeof claims.nonce !== "string" || claims.nonce !== expected.nonce) {
    throw new SignInError("failed", "ID token nonce does not match")
  }

  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    throw new SignInError("failed", "ID token has no subject")
  }

  if (typeof claims.email !== "string" || claims.email.length === 0) {
    throw new SignInError("failed", "ID token has no email; was the email scope granted?")
  }

  // Historically sometimes the string "true".
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    throw new SignInError("unverified", `Email ${claims.email} is not verified by Google`)
  }

  return {
    sub: claims.sub,
    email: claims.email.toLowerCase(),
    name: typeof claims.name === "string" && claims.name.length > 0 ? claims.name : null,
  }
}

/**
 * Trades an authorization code for the signed-in user's identity.
 *
 * `fetchImpl` is injectable for tests; in the app it is the global fetch.
 */
export async function exchangeCode(
  params: {
    clientId: string
    clientSecret: string
    appUrl: string
    code: string
    codeVerifier: string
    nonce: string
  },
  fetchImpl: typeof fetch = fetch
): Promise<GoogleIdentity> {
  let response: Response
  try {
    response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        client_id: params.clientId,
        client_secret: params.clientSecret,
        redirect_uri: redirectUri(params.appUrl),
        code_verifier: params.codeVerifier,
      }).toString(),
      // A code is single-use and Google answers in well under a second; a
      // hung request should fail the sign-in, not hold the connection open.
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    })
  } catch (error) {
    throw new SignInError("failed", `Token request failed: ${error instanceof Error ? error.message : error}`)
  }

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null

  if (!response.ok || !body) {
    // Google's error codes (invalid_grant, redirect_uri_mismatch, ...) are the
    // whole diagnosis for a misconfigured client, so log them — server side.
    throw new SignInError(
      "failed",
      `Token endpoint returned ${response.status}: ${body?.error ?? "?"} ${body?.error_description ?? ""}`.trim()
    )
  }

  if (typeof body.id_token !== "string") {
    throw new SignInError("failed", "Token response has no id_token; is `openid` in the scope?")
  }

  const claims = decodeJwtPayload(body.id_token)
  if (!claims) {
    throw new SignInError("failed", "id_token is not a decodable JWT")
  }

  return validateIdTokenClaims(claims, { clientId: params.clientId, nonce: params.nonce })
}
