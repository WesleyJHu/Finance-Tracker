/**
 * Generates AUTH_SECRET and AUTH_PASSWORD_HASH.
 *
 *   npm run auth:setup
 *
 * The password is read from stdin rather than argv so it does not land in
 * shell history or the process list, and only its hash is ever printed.
 */
import { randomBytes } from "node:crypto"
import { createInterface } from "node:readline"
import { hashPassword } from "@/lib/password"

const MIN_LENGTH = 12

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

async function main() {
  process.stderr.write(
    "Setting up the single-user login.\n" +
      "The password is not echoed back and is never written anywhere in plain text.\n\n"
  )

  const password = (await prompt("Password: ")).trim()

  if (password.length < MIN_LENGTH) {
    // A short password is the whole attack surface here: there is no lockout
    // an attacker cannot wait out, and the hash is in a file on the host.
    throw new Error(`Password must be at least ${MIN_LENGTH} characters.`)
  }

  const confirmation = (await prompt("Confirm: ")).trim()
  if (password !== confirmation) {
    throw new Error("Passwords do not match.")
  }

  process.stderr.write("\nHashing (this takes a moment by design)...\n\n")

  const hash = await hashPassword(password)
  // 32 random bytes, so a session token cannot be forged by guessing.
  const secret = randomBytes(32).toString("base64")

  // stdout only, so `npm run auth:setup >> .env.local` captures exactly the
  // two lines and none of the prompts above.
  process.stdout.write(`AUTH_SECRET=${secret}\n`)
  process.stdout.write(`AUTH_PASSWORD_HASH=${hash}\n`)

  process.stderr.write(
    "Add those two lines to .env.local (local dev) or .env (docker compose),\n" +
      "then restart. Rotating AUTH_SECRET signs out every existing session.\n"
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
