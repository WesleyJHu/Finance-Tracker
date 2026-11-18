/**
 * Requests that carry a real, signed session cookie.
 *
 * Every data route resolves its user from the cookie (src/lib/session.ts), so
 * the tests call the handlers exactly as the browser does — no mocked
 * `requireUser`, which would leave the one thing these tests guard untested.
 */
import { NextRequest } from "next/server"
import { SESSION_COOKIE, createSessionToken } from "@/lib/auth"

export type TestUser = { id: string; email: string }

type Init = { method?: string; headers?: Record<string, string>; body?: string }

export async function sessionCookie(user: TestUser): Promise<string> {
  const token = await createSessionToken(process.env.AUTH_SECRET as string, {
    userId: user.id,
    email: user.email,
  })
  return `${SESSION_COOKIE}=${token}`
}

/** A request signed in as `user`. */
export async function authed(user: TestUser, url: string, init: Init = {}): Promise<NextRequest> {
  return new NextRequest(url, {
    ...init,
    headers: { ...init.headers, cookie: await sessionCookie(user) },
  })
}

/** A JSON request signed in as `user`. */
export function authedJson(user: TestUser, url: string, method: string, body: unknown) {
  return authed(user, url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}
