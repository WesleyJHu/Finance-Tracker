/**
 * The signed-in user, for route handlers.
 *
 * Every data route starts with `const { userId } = await requireUser(req)`
 * and passes that id into every query it runs. The middleware has already
 * turned away requests without a valid session, but routes verify the cookie
 * again themselves rather than trusting a header the middleware set: a
 * forwarded `x-user-id` is one misconfigured matcher away from being
 * attacker-supplied, while the cookie's signature is not. It is one HMAC.
 */
import type { NextRequest } from "next/server"
import { HttpError } from "@/lib/db"
import { SESSION_COOKIE, authenticate, readSessionConfig, type SessionUser } from "@/lib/auth"

export async function requireUser(req: NextRequest): Promise<SessionUser> {
  const config = readSessionConfig()
  if (!config.ok) {
    console.error(`Auth is not configured: ${config.reason}`)
    throw new HttpError(503, "Server is not configured for authentication")
  }

  const user = await authenticate(config.config, req.cookies.get(SESSION_COOKIE)?.value)
  if (!user) {
    throw new HttpError(401, "Not authenticated")
  }
  return user
}
