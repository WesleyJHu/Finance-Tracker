/**
 * Turning a Google identity into a row in `users`.
 *
 * Node only (it uses the pool), so it is imported by the callback route and
 * never by middleware.
 */
import type { PoolClient } from "pg"
import { withTransaction } from "@/lib/db"
import { SignInError, type GoogleIdentity } from "@/lib/google"
import { todayInAppTz } from "@/lib/dates"
import type { SessionUser } from "@/lib/auth"

const UNIQUE_VIOLATION = "23505"

/**
 * Finds the user for a Google identity, creating one on first sign-in.
 *
 * In order:
 *
 *   1. A user with this google_sub: the normal case for everyone after their
 *      first sign-in. Email and name are refreshed from Google.
 *   2. A user with this email and no google_sub yet: someone created ahead of
 *      time — the owner of the data that predates multi-user support, created
 *      by db/migrations/0002_multi_user.sql. Their google_sub is filled in, and
 *      from then on they are matched by (1). The caller has already required
 *      email_verified, without which anyone could create a Google account
 *      with the owner's address and inherit their data.
 *   3. A user with this email and a *different* google_sub: refused. It means
 *      the address now belongs to a different Google account than the one
 *      that first signed in with it (a deleted and re-created account, or a
 *      Workspace address reassigned). Handing over the old account's data on
 *      the strength of the email alone is exactly what google_sub prevents.
 *   4. Nobody: a new user, with their 12 budget rows and this month's opening
 *      snapshot, so the dashboard and the monthly job work for them at once.
 */
export async function signInWithGoogle(identity: GoogleIdentity): Promise<SessionUser> {
  // Two first sign-ins racing (a double-clicked button, two tabs) can both
  // reach step 4; the loser hits a unique violation and retries, which then
  // finds the winner's row in step 1.
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTransaction((client) => findOrCreate(client, identity))
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === UNIQUE_VIOLATION && attempt === 0) continue
      throw error
    }
  }
}

async function findOrCreate(client: PoolClient, identity: GoogleIdentity): Promise<SessionUser> {
  const bySub = await client.query(
    `SELECT id FROM users WHERE google_sub = $1 FOR UPDATE`,
    [identity.sub]
  )

  if (bySub.rowCount !== 0) {
    const userId: string = bySub.rows[0].id
    // The email is only refreshed when no other user holds it, so an address
    // moving between Google accounts cannot make this sign-in fail.
    const updated = await client.query(
      `UPDATE users
          SET email = CASE
                WHEN NOT EXISTS (SELECT 1 FROM users other WHERE other.email = $2 AND other.id <> $1)
                THEN $2 ELSE email END,
              name = COALESCE($3, name),
              last_login_at = now()
        WHERE id = $1
      RETURNING email`,
      [userId, identity.email, identity.name]
    )
    return { userId, email: updated.rows[0].email }
  }

  const byEmail = await client.query(
    `SELECT id, google_sub FROM users WHERE email = $1 FOR UPDATE`,
    [identity.email]
  )

  if (byEmail.rowCount !== 0) {
    const existing = byEmail.rows[0]
    if (existing.google_sub !== null) {
      throw new SignInError(
        "conflict",
        `${identity.email} is linked to Google account ${existing.google_sub}, ` +
          `not ${identity.sub}. Refusing to sign in.`
      )
    }

    await client.query(
      `UPDATE users
          SET google_sub = $2, name = COALESCE($3, name), last_login_at = now()
        WHERE id = $1`,
      [existing.id, identity.sub, identity.name]
    )
    console.log(`Linked existing user ${identity.email} to their Google account`)
    return { userId: existing.id, email: identity.email }
  }

  const inserted = await client.query(
    `INSERT INTO users (google_sub, email, name, last_login_at)
     VALUES ($1, $2, $3, now())
     RETURNING id`,
    [identity.sub, identity.email, identity.name]
  )
  const userId: string = inserted.rows[0].id

  await provisionUser(client, userId)
  console.log(`Created user ${identity.email}`)

  return { userId, email: identity.email }
}

/**
 * What a new user needs before the app works for them: what db/seed.sql used
 * to create once for the whole database.
 *
 * - 12 monthly_budgets rows at 0. Settings edits them; the monthly job fails
 *   for a user with no row for the month it is opening.
 * - This month's snapshot, opening at 0. The dashboard's Remaining Budget
 *   reads it, and the monthly job reads it as "last month" on the 1st.
 *   starting_balance is defined as last month's ending balance plus this
 *   month's budget, and both are 0 for someone who has just arrived.
 */
export async function provisionUser(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `INSERT INTO monthly_budgets (user_id, month, base_budget)
     SELECT $1, month, 0 FROM generate_series(1, 12) AS month
     ON CONFLICT (user_id, month) DO NOTHING`,
    [userId]
  )

  const today = todayInAppTz()
  await client.query(
    `INSERT INTO monthly_balance_snapshot (user_id, starting_balance, month, year)
     VALUES ($1, 0, $2, $3)
     ON CONFLICT (user_id, month, year) DO NOTHING`,
    [userId, today.month, today.year]
  )
}
