import { NextRequest, NextResponse } from "next/server"
import { handleRouteError } from "@/lib/api"
import { requireUser } from "@/lib/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Who is signed in: `{ "email": "..." }`, or 401.
 *
 * Read from the session cookie, not the database — it is what the session
 * says, which is what every other route acts on.
 */
export async function GET(req: NextRequest) {
  try {
    const { email } = await requireUser(req)
    return NextResponse.json({ email })
  } catch (error) {
    return handleRouteError(error, "GET /auth/session")
  }
}
