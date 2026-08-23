/**
 * Session tokens for the single-user login.
 *
 * This module is imported by src/middleware.ts, which Next runs on the Edge
 * runtime — so it must use Web Crypto only. Nothing here may import from
 * `node:*`. Password hashing needs scrypt and therefore Node, so it lives
 * separately in src/lib/password.ts, which only the login route imports.
 *
 * The session is a signed cookie carrying nothing but an expiry: there is one
 * user, so there is no identity to encode and no reason for a sessions table.
 * That makes sessions stateless, which means an individual session cannot be
 * revoked — rotating AUTH_SECRET invalidates all of them at once, and for a
 * self-hosted single-user app that is the right trade.
 */

export const SESSION_COOKIE = "finance_session"

/** How long a login lasts. Re-login after this, with no sliding renewal. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

/**
 * Set to "true" to run with no login at all.
 *
 * Auth is otherwise fail-closed: if AUTH_SECRET or AUTH_PASSWORD_HASH is
 * missing, every request is refused rather than served. A security control
 * that silently switches itself off when misconfigured is worse than none,
 * because you cannot tell the difference from the outside.
 */
export function authDisabled(): boolean {
  return process.env.AUTH_DISABLED === "true"
}

export type AuthConfig = { secret: string; passwordHash: string }

/** Returns the configured secrets, or a message naming what is missing. */
export function readAuthConfig(): { ok: true; config: AuthConfig } | { ok: false; reason: string } {
  const secret = process.env.AUTH_SECRET
  const passwordHash = process.env.AUTH_PASSWORD_HASH

  const missing = [
    !secret && "AUTH_SECRET",
    !passwordHash && "AUTH_PASSWORD_HASH",
  ].filter(Boolean)

  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        `${missing.join(" and ")} not set. Run \`npm run auth:setup\` to generate ` +
        `them, or set AUTH_DISABLED=true to run without a login.`,
    }
  }

  return { ok: true, config: { secret: secret as string, passwordHash: passwordHash as string } }
}

const encoder = new TextEncoder()

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64UrlDecode(value: string): Uint8Array | null {
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
 * `<base64url payload>.<base64url signature>`.
 *
 * The payload is not encrypted — it holds only an expiry, which is not secret.
 * The signature is what matters: without AUTH_SECRET a client cannot mint a
 * token or extend one it already has.
 */
export async function createSessionToken(
  secret: string,
  now: number = Date.now()
): Promise<string> {
  const payload = JSON.stringify({ v: 1, exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS })
  const payloadBytes = encoder.encode(payload)
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), payloadBytes)

  return `${base64UrlEncode(payloadBytes)}.${base64UrlEncode(new Uint8Array(signature))}`
}

/**
 * True only for a token this secret signed and whose expiry has not passed.
 *
 * `crypto.subtle.verify` does the comparison, so the signature check is
 * constant-time rather than a `===` on two strings.
 */
export async function verifySessionToken(
  secret: string,
  token: string | undefined,
  now: number = Date.now()
): Promise<boolean> {
  if (!token) return false

  const parts = token.split(".")
  if (parts.length !== 2) return false

  const payloadBytes = base64UrlDecode(parts[0])
  const signatureBytes = base64UrlDecode(parts[1])
  if (!payloadBytes || !signatureBytes) return false

  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    signatureBytes as BufferSource,
    payloadBytes as BufferSource
  )
  if (!valid) return false

  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes))
    return typeof payload?.exp === "number" && payload.exp * 1000 > now
  } catch {
    return false
  }
}

/** Cookie attributes for the session. */
export function sessionCookieOptions(maxAge: number = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    // Lax, not Strict: Strict would drop the cookie when arriving from an
    // external link, showing a spurious login screen.
    sameSite: "lax" as const,
    path: "/",
    // Off by default because this is normally served over plain HTTP on a LAN,
    // where a Secure cookie is never sent and login silently fails. Set
    // AUTH_COOKIE_SECURE=true behind a TLS reverse proxy.
    secure: process.env.AUTH_COOKIE_SECURE === "true",
    maxAge,
  }
}
