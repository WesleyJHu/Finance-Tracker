import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export const runtime = "nodejs"
// Never cached or prerendered: a cached "ok" would make the container look
// healthy after the database had gone away.
export const dynamic = "force-dynamic"

/**
 * Liveness plus a database round trip, for the Dockerfile's HEALTHCHECK and
 * for compose's `depends_on: service_healthy`.
 *
 * It checks the pool rather than just returning 200, because the failure this
 * needs to catch is the app running fine while unable to reach Postgres. The
 * query is deliberately trivial — this runs every 30 seconds.
 */
export async function GET() {
  try {
    await pool.query("SELECT 1")
    return NextResponse.json({ status: "ok" })
  } catch (error) {
    // Logged, not returned: the response body is reachable without
    // authentication, so it must not describe the internals.
    console.error("Health check failed:", error)
    return NextResponse.json({ status: "unhealthy" }, { status: 503 })
  }
}
