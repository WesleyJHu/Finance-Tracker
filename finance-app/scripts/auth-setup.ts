/**
 * Generates AUTH_SECRET and AUTH_PASSWORD_HASH and writes them to an env file.
 *
 *   npm run auth:setup                  # updates .env.local (local development)
 *   npm run auth:setup -- --env .env    # updates .env (docker compose)
 *
 * It edits the file itself rather than printing two lines for you to redirect,
 * because `npm run auth:setup >> .env` is broken in two ways that are invisible
 * until login silently fails:
 *
 *   - npm prints its own "> package@version script" banner on stdout, which
 *     lands in the file as if it were a variable.
 *   - PowerShell's `>>` writes UTF-16LE with a BOM, which no dotenv parser
 *     reads. The lines look correct in an editor and parse as nothing.
 *
 * And having written the file it reads it back through Next's own loader,
 * because a third failure of the same kind — dotenv-expand eating the `$` in
 * the old hash format — also showed up only as "the password is wrong".
 *
 * The password is read from stdin, never echoed, and never written anywhere in
 * plain text — only its scrypt hash is stored.
 */
import fs from "node:fs"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { createInterface } from "node:readline"
import { loadEnvConfig } from "@next/env"
import { hashPassword, isValidHashFormat } from "@/lib/password"

const MIN_LENGTH = 12
const MANAGED_KEYS = ["AUTH_SECRET", "AUTH_PASSWORD_HASH"] as const

type Options = { envPath: string | null; print: boolean }

function parseArgs(argv: string[]): Options {
  const options: Options = { envPath: ".env.local", print: false }

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--print") {
      options.print = true
      options.envPath = null
    } else if (argv[i] === "--env") {
      const value = argv[++i]
      if (!value) throw new Error("--env needs a file path, e.g. --env .env")
      options.envPath = value
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`)
    }
  }

  return options
}

/**
 * Reads lines without echoing them.
 *
 * One interface for every prompt, not one per prompt: a readline interface
 * over a pipe buffers all of stdin, so closing it after the first question
 * threw the second answer away and the process exited 0 having done nothing.
 *
 * readline echoes by default, so the password would otherwise sit in the
 * scrollback of whoever ran this. Muting _writeToOutput once each prompt has
 * been written suppresses the typed characters but keeps the prompt visible.
 */
function createPrompter() {
  // Nothing is echoed for piped input anyway, and forcing terminal mode on a
  // pipe misbehaves.
  const interactive = process.stdin.isTTY === true

  // Piped input is read whole and handed out a line at a time. readline over a
  // pipe emits every line as fast as it can read them, and a line that arrives
  // while no question is pending is simply dropped — so the second prompt saw
  // EOF and the script did nothing.
  if (!interactive) {
    const lines = fs.readFileSync(0, "utf8").split(/\r?\n/)
    let index = 0
    return {
      async hidden(question: string): Promise<string> {
        process.stderr.write(question)
        if (index >= lines.length) {
          throw new Error("Input ended before a password was entered.")
        }
        const answer = lines[index++]
        process.stderr.write("\n")
        return answer
      },
      close() {},
    }
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: interactive,
  })

  let muted = false
  if (interactive) {
    const internals = rl as unknown as { _writeToOutput: (value: string) => void }
    internals._writeToOutput = (value: string) => {
      if (!muted) process.stderr.write(value)
    }
  }

  let onEof: (() => void) | null = null
  rl.on("close", () => onEof?.())

  return {
    hidden(question: string): Promise<string> {
      return new Promise((resolve, reject) => {
        let answered = false
        // Without this, EOF leaves the promise pending forever and Node exits
        // silently with status 0 having written nothing.
        onEof = () => {
          if (!answered) reject(new Error("Input ended before a password was entered."))
        }

        rl.question(question, (answer) => {
          answered = true
          muted = false
          if (interactive) process.stderr.write("\n")
          resolve(answer)
        })
        muted = true
      })
    },
    close() {
      onEof = null
      rl.close()
    },
  }
}

/**
 * Replaces the managed keys in an env file, leaving everything else alone.
 *
 * Always written as UTF-8 with LF endings, and any existing BOM is dropped, so
 * a file previously mangled by PowerShell redirection is repaired rather than
 * appended to.
 */
function writeEnvFile(envPath: string, values: Record<string, string>) {
  const absolute = path.resolve(process.cwd(), envPath)

  let existing = ""
  if (fs.existsSync(absolute)) {
    const raw = fs.readFileSync(absolute)
    // UTF-16LE, as PowerShell's > and >> produce.
    existing =
      raw[0] === 0xff && raw[1] === 0xfe
        ? raw.subarray(2).toString("utf16le")
        : raw.toString("utf8").replace(/^﻿/, "")
  }

  const kept = existing
    .split(/\r?\n/)
    .filter((line) => !MANAGED_KEYS.some((key) => line.startsWith(`${key}=`)))
    // npm's script banner, if a previous run was redirected into this file.
    .filter((line) => !/^>\s/.test(line))

  while (kept.length > 0 && kept[kept.length - 1].trim() === "") kept.pop()

  const body = [
    ...kept,
    "",
    "# Written by `npm run auth:setup`. Rotating AUTH_SECRET signs out every",
    "# existing session. Only the scrypt hash of the password is stored.",
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
    "",
  ].join("\n")

  fs.writeFileSync(absolute, body, { encoding: "utf8" })
  return absolute
}

/**
 * Reads the file back the way Next will, and fails loudly if it does not match.
 *
 * Next runs dotenv-expand over .env files, so not every value survives being
 * written to one — a `$` is read as a variable reference. That is exactly how
 * the previous hash format broke, and it was invisible from the login form:
 * the password was simply always wrong. Checking here means a future format or
 * encoding problem is caught at setup time, by the tool that caused it.
 */
function verifyRoundTrip(envPath: string, values: Record<string, string>) {
  const { combinedEnv } = loadEnvConfig(
    path.dirname(envPath),
    true,
    { info: () => {}, error: () => {} },
    true
  )

  for (const [key, expected] of Object.entries(values)) {
    const actual = combinedEnv?.[key]
    if (actual !== expected) {
      throw new Error(
        [
          `${key} does not survive being read back from ${envPath}.`,
          `  wrote: ${expected}`,
          `  read:  ${actual ?? "(nothing)"}`,
          `This is a bug in auth:setup, not in your password.`,
        ].join("\n")
      )
    }
  }

  if (!isValidHashFormat(combinedEnv?.AUTH_PASSWORD_HASH)) {
    throw new Error(`AUTH_PASSWORD_HASH read back from ${envPath} is not a valid hash.`)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  process.stderr.write(
    "Setting up the single-user login.\n" +
      "Your password is not shown as you type, and is never stored in plain text.\n" +
      "Spaces are allowed and count — including at the start and end.\n\n"
  )

  const prompter = createPrompter()
  let password: string
  let confirmation: string
  try {
    password = await prompter.hidden("Password: ")
    confirmation = await prompter.hidden("Confirm:  ")
  } finally {
    prompter.close()
  }

  if (password.length < MIN_LENGTH) {
    // A short password is the whole attack surface: the lockout resets on
    // restart, and the hash sits in a file on the host.
    throw new Error(
      `Password must be at least ${MIN_LENGTH} characters (got ${password.length}).`
    )
  }

  if (password !== confirmation) {
    throw new Error("Passwords do not match. Nothing was changed.")
  }

  if (password !== password.trim()) {
    // Not rejected, just surfaced: this is otherwise impossible to spot later
    // and looks exactly like "the password stopped working".
    process.stderr.write(
      "\nNote: your password starts or ends with a space. That is kept, and you\n" +
        "will have to type it exactly the same way to sign in.\n"
    )
  }

  process.stderr.write("\nHashing (slow by design)...\n")

  const values = {
    // 32 random bytes, so a session cookie cannot be forged by guessing.
    AUTH_SECRET: randomBytes(32).toString("base64"),
    AUTH_PASSWORD_HASH: await hashPassword(password),
  }

  if (options.print || !options.envPath) {
    process.stderr.write(
      "\nPrinting to stdout. Use `npm run --silent auth:setup -- --print` so npm's\n" +
        "banner is not included, and note that PowerShell redirection writes UTF-16,\n" +
        "which dotenv cannot read.\n\n"
    )
    for (const [key, value] of Object.entries(values)) {
      process.stdout.write(`${key}=${value}\n`)
    }
    return
  }

  const written = writeEnvFile(options.envPath, values)

  verifyRoundTrip(written, values)

  process.stderr.write(`\nUpdated ${written}\n`)
  process.stderr.write("Restart the app for it to take effect.\n")

  if (path.basename(written) === ".env") {
    process.stderr.write(
      "\nThis is the docker compose env file. For `npm run dev`, set it in\n" +
        ".env.local instead — Next gives .env.local priority over .env, so a\n" +
        "value there will win.\n"
    )
  }
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
