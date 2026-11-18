/**
 * Sessions and auth configuration.
 *
 * This module is imported by src/middleware.ts, which Next runs on the Edge
 * runtime — so it must use Web Crypto only. Nothing here may import from
 * `node:*` or from src/lib/db.ts.
 *
 * Sign-in is Google OAuth (src/lib/google.ts, src/app/api/auth/google/*). Once
 * signed in, the session is a signed cookie carrying the user's id, email and
 * an expiry. It is stateless: there is no sessions table, so one session
 * cannot be revoked on its own. Two levers instead:
 *
 *   - Remove someone from AUTH_ALLOWED_EMAILS and restart. The email is in
 *     the token and checked on every request, so their session stops working
 *     immediately rather than at expiry.
 *   - Rotate AUTH_SECRET and restart, which signs out everyone.
 */

export const SESSION_COOKIE = "finance_session"

/** How long a login lasts. Re-login after this, with no sliding renewal. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

/** Who a valid session belongs to. */
export type SessionUser = { userId: string; email: string }

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * What every authenticated request needs: the key that signs sessions, and
 * who is allowed in.
 *
 * Fail-closed: if either is missing, the middleware refuses every request
 * rather than serving data. A security control that silently switches itself
 * off when misconfigured is worse than none, because you cannot tell the
 * difference from the outside.
 */
export type SessionConfig = { secret: string; allowedEmails: AllowedEmails }

/** `"*"` admits any verified Google account; otherwise an explicit set. */
export type AllowedEmails = "*" | ReadonlySet<string>

/** What sign-in additionally needs, on top of SessionConfig. */
export type GoogleConfig = {
  clientId: string
  clientSecret: string
  /**
   * The app's public origin, e.g. https://finance.example.ts.net. Google
   * redirects back to `${appUrl}/api/auth/google/callback`, which must be
   * registered verbatim in the Google Cloud console.
   */
  appUrl: string
}

type ConfigResult<T> = { ok: true; config: T } | { ok: false; reason: string }

function missingReason(missing: (string | false)[]): string | null {
  const names = missing.filter(Boolean)
  return names.length === 0
    ? null
    : `${names.join(", ")} not set. See finance-app/.env.example.`
}

/**
 * AUTH_ALLOWED_EMAILS: comma- or whitespace-separated addresses, or `*`.
 *
 * Required, with no permissive default. Leaving it unset must not mean
 * "anyone with a Google account", because that is everyone.
 */
export function parseAllowedEmails(raw: string | undefined): AllowedEmails | null {
  if (raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed === "*") return "*"

  const emails = trimmed
    .split(/[\s,]+/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0)

  return emails.length === 0 ? null : new Set(emails)
}

export function isEmailAllowed(email: string, allowed: AllowedEmails): boolean {
  return allowed === "*" || allowed.has(email.toLowerCase())
}

export function readSessionConfig(): ConfigResult<SessionConfig> {
  const secret = process.env.AUTH_SECRET
  const allowedEmails = parseAllowedEmails(process.env.AUTH_ALLOWED_EMAILS)

  const reason = missingReason([
    !secret && "AUTH_SECRET",
    !allowedEmails && "AUTH_ALLOWED_EMAILS",
  ])
  if (reason) return { ok: false, reason }

  return {
    ok: true,
    config: { secret: secret as string, allowedEmails: allowedEmails as AllowedEmails },
  }
}

export function readGoogleConfig(): ConfigResult<GoogleConfig> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const rawUrl = process.env.AUTH_URL

  const reason = missingReason([
    !clientId && "GOOGLE_CLIENT_ID",
    !clientSecret && "GOOGLE_CLIENT_SECRET",
    !rawUrl && "AUTH_URL",
  ])
  if (reason) return { ok: false, reason }

  let appUrl: string
  try {
    const parsed = new URL(rawUrl as string)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error()
    // Origin only: a trailing slash or path here would produce a redirect_uri
    // that does not match the one registered with Google.
    appUrl = parsed.origin
  } catch {
    return { ok: false, reason: `AUTH_URL is not a valid http(s) URL: ${rawUrl}` }
  }

  return {
    ok: true,
    config: { clientId: clientId as string, clientSecret: clientSecret as string, appUrl },
  }
}

// ---------------------------------------------------------------------------
// Signed tokens
// ---------------------------------------------------------------------------

const encoder = new TextEncoder()

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function base64UrlDecode(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  )
}

/**
 * Two kinds of token are signed with AUTH_SECRET: the session, and the
 * short-lived OAuth state cookie. `typ` keeps them apart, so one can never be
 * replayed as the other — without it, copying the state cookie's value into
 * the session cookie would be a signature-valid session.
 */
type TokenType = "session" | "oauth"

/**
 * `<base64url payload>.<base64url signature>`.
 *
 * The payload is signed, not encrypted. Nothing in either kind is secret from
 * the browser that holds it, and both cookies are HttpOnly anyway; the
 * signature is what stops a client minting or editing one.
 */
export async function signToken(
  secret: string,
  typ: TokenType,
  claims: Record<string, unknown>,
  ttlSeconds: number,
  now: number = Date.now()
): Promise<string> {
  const payload = JSON.stringify({ ...claims, typ, exp: Math.floor(now / 1000) + ttlSeconds })
  const payloadBytes = encoder.encode(payload)
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), payloadBytes)

  return `${base64UrlEncode(payloadBytes)}.${base64UrlEncode(new Uint8Array(signature))}`
}

/**
 * The payload of a token this secret signed, of this type, whose expiry has
 * not passed — or null.
 *
 * `crypto.subtle.verify` does the comparison, so the signature check is
 * constant-time rather than a `===` on two strings.
 */
export async function verifyToken(
  secret: string,
  typ: TokenType,
  token: string | undefined,
  now: number = Date.now()
): Promise<Record<string, unknown> | null> {
  if (!token) return null

  const parts = token.split(".")
  if (parts.length !== 2) return null

  const payloadBytes = base64UrlDecode(parts[0])
  const signatureBytes = base64UrlDecode(parts[1])
  if (!payloadBytes || !signatureBytes) return null

  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    signatureBytes as BufferSource,
    payloadBytes as BufferSource
  )
  if (!valid) return null

  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes))
    if (typeof payload !== "object" || payload === null) return null
    if (payload.typ !== typ) return null
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= now) return null
    return payload
  } catch {
    return null
  }
}

export async function createSessionToken(
  secret: string,
  user: SessionUser,
  now: number = Date.now()
): Promise<string> {
  return signToken(
    secret,
    "session",
    { v: 2, uid: user.userId, email: user.email.toLowerCase() },
    SESSION_TTL_SECONDS,
    now
  )
}

/**
 * The user a session belongs to, or null if it is not a valid session.
 *
 * v1 tokens — from the old single-password login — carry no user and are
 * rejected, so everyone signed in before the switch to Google is sent to the
 * sign-in page once.
 */
export async function verifySessionToken(
  secret: string,
  token: string | undefined,
  now: number = Date.now()
): Promise<SessionUser | null> {
  const payload = await verifyToken(secret, "session", token, now)
  if (!payload || payload.v !== 2) return null
  if (typeof payload.uid !== "string" || payload.uid.length === 0) return null
  if (typeof payload.email !== "string" || payload.email.length === 0) return null
  return { userId: payload.uid, email: payload.email }
}

/**
 * Verifies a session and applies the allowlist: what both the middleware and
 * every route handler call. Null means "not signed in", for any reason.
 */
export async function authenticate(
  config: SessionConfig,
  token: string | undefined,
  now: number = Date.now()
): Promise<SessionUser | null> {
  const user = await verifySessionToken(config.secret, token, now)
  if (!user || !isEmailAllowed(user.email, config.allowedEmails)) return null
  return user
}

/**
 * `value` if it is a same-origin path, otherwise "/".
 *
 * The post-sign-in destination arrives in a query string, so it is attacker
 * controllable. Only a path is ever accepted, never a URL: "//evil.com" and
 * "/\evil.com" are both read by browsers as protocol-relative URLs to another
 * host, so both are refused along with anything absolute.
 */
export function safeRedirectPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) return "/"
  if (value.startsWith("//") || value.startsWith("/\\")) return "/"
  // Control characters (a tab or newline inside "//") are stripped by URL
  // parsers before they look at the slashes.
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/"
  return value
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

/**
 * Whether cookies are marked Secure.
 *
 * Follows AUTH_URL by default: Google only redirects to https origins (other
 * than localhost), so a real deployment is https and its cookies should be
 * Secure. AUTH_COOKIE_SECURE overrides it either way — "false" for plain-HTTP
 * development on a hostname other than localhost.
 */
export function cookieSecure(): boolean {
  const override = process.env.AUTH_COOKIE_SECURE
  if (override === "true") return true
  if (override === "false") return false
  return (process.env.AUTH_URL ?? "").startsWith("https://")
}

/** Cookie attributes for the session. */
export function sessionCookieOptions(maxAge: number = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    // Lax, not Strict: the OAuth callback is a cross-site navigation from
    // accounts.google.com, and Strict would drop the state cookie on it. It
    // would also show a spurious login screen when following an external link.
    sameSite: "lax" as const,
    path: "/",
    secure: cookieSecure(),
    maxAge,
  }
}
