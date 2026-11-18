/**
 * Writes the Google sign-in settings to an env file.
 *
 *   npm run auth:setup                  # updates .env.local (local development)
 *   npm run auth:setup -- --env .env    # updates .env (docker compose)
 *   npm run auth:setup -- --rotate-secret   # also signs everyone out
 *
 * Prompts for GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, AUTH_URL and
 * AUTH_ALLOWED_EMAILS, offering the file's current value as the default, and
 * generates AUTH_SECRET if there is not one yet. It removes the old
 * AUTH_PASSWORD_HASH, which nothing reads any more.
 *
 * It edits the file itself rather than printing lines for you to redirect,
 * because `npm run auth:setup >> .env` is broken in two ways that are invisible
 * until sign-in silently fails:
 *
 *   - npm prints its own "> package@version script" banner on stdout, which
 *     lands in the file as if it were a variable.
 *   - PowerShell's `>>` writes UTF-16LE with a BOM, which no dotenv parser
 *     reads. The lines look correct in an editor and parse as nothing.
 *
 * And having written the file it reads it back through Next's own loader,
 * because Next runs dotenv-expand over env files and a `$` in a value is
 * silently eaten — which is how the old password hash format broke.
 */
import fs from "node:fs"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { createInterface } from "node:readline"
import { loadEnvConfig } from "@next/env"
import { parseAllowedEmails } from "@/lib/auth"

const MANAGED_KEYS = [
  "AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "AUTH_URL",
  "AUTH_ALLOWED_EMAILS",
] as const

/** Removed from the file: the password login they configured is gone. */
const RETIRED_KEYS = ["AUTH_PASSWORD_HASH", "AUTH_DISABLED", "NEXT_PUBLIC_AUTH_DISABLED"]

type Options = { envPath: string; rotateSecret: boolean }

function parseArgs(argv: string[]): Options {
  const options: Options = { envPath: ".env.local", rotateSecret: false }

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--rotate-secret") {
      options.rotateSecret = true
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
 * Reads answers line by line, optionally without echo.
 *
 * One interface for every prompt, not one per prompt: a readline interface
 * over a pipe buffers all of stdin, so closing it after the first question
 * threw the later answers away.
 */
function createPrompter() {
  const interactive = process.stdin.isTTY === true

  // Piped input is read whole and handed out a line at a time. readline over a
  // pipe emits every line as fast as it can read them, and a line that arrives
  // while no question is pending is simply dropped.
  if (!interactive) {
    const lines = fs.readFileSync(0, "utf8").split(/\r?\n/)
    let index = 0
    const ask = async (question: string): Promise<string> => {
      process.stderr.write(question)
      if (index >= lines.length) throw new Error("Input ended before every question was answered.")
      const answer = lines[index++]
      process.stderr.write("\n")
      return answer
    }
    return { ask, hidden: ask, close() {} }
  }

  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true })

  // readline echoes by default. Muting _writeToOutput once the prompt has been
  // written suppresses the typed characters but keeps the prompt visible.
  let muted = false
  const internals = rl as unknown as { _writeToOutput: (value: string) => void }
  internals._writeToOutput = (value: string) => {
    if (!muted) process.stderr.write(value)
  }

  let onEof: (() => void) | null = null
  rl.on("close", () => onEof?.())

  const question = (prompt: string, hide: boolean): Promise<string> =>
    new Promise((resolve, reject) => {
      let answered = false
      onEof = () => {
        if (!answered) reject(new Error("Input ended before every question was answered."))
      }
      rl.question(prompt, (answer) => {
        answered = true
        if (hide) process.stderr.write("\n")
        muted = false
        resolve(answer)
      })
      muted = hide
    })

  return {
    ask: (prompt: string) => question(prompt, false),
    hidden: (prompt: string) => question(prompt, true),
    close() {
      onEof = null
      rl.close()
    },
  }
}

/** Reads an env file, repairing the encodings PowerShell redirection produces. */
function readEnvFile(absolute: string): string {
  if (!fs.existsSync(absolute)) return ""
  const raw = fs.readFileSync(absolute)
  // UTF-16LE, as PowerShell's > and >> produce.
  return raw[0] === 0xff && raw[1] === 0xfe
    ? raw.subarray(2).toString("utf16le")
    : raw.toString("utf8").replace(/^﻿/, "")
}

/** The last value each managed key has in the file (later lines win, as in dotenv). */
function currentValues(contents: string): Partial<Record<string, string>> {
  const values: Partial<Record<string, string>> = {}
  for (const line of contents.split(/\r?\n/)) {
    for (const key of MANAGED_KEYS) {
      if (line.startsWith(`${key}=`)) values[key] = line.slice(key.length + 1)
    }
  }
  return values
}

/**
 * Replaces the managed keys, drops the retired ones, and leaves everything
 * else alone. Always written as UTF-8 with LF endings.
 */
function writeEnvFile(absolute: string, existing: string, values: Record<string, string>) {
  const kept = existing
    .split(/\r?\n/)
    .filter(
      (line) =>
        ![...MANAGED_KEYS, ...RETIRED_KEYS].some((key) => line.startsWith(`${key}=`))
    )
    // The comment block this script writes above its keys, in both its old
    // (password) and current wording, so a re-run does not stack copies.
    .filter(
      (line) =>
        !/^# Written by `npm run auth:setup`|^# existing session\. Only the scrypt hash|^# signs out every existing session\.$/.test(
          line
        )
    )
    // npm's script banner, if a previous run was redirected into this file.
    .filter((line) => !/^>\s/.test(line))

  // Collapse the blank runs left behind by removed blocks.
  const collapsed = kept.filter((line, i) => !(line.trim() === "" && kept[i - 1]?.trim() === ""))
  while (collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === "") collapsed.pop()

  const body = [
    ...collapsed,
    "",
    "# Written by `npm run auth:setup` — Google sign-in. Rotating AUTH_SECRET",
    "# signs out every existing session.",
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
    "",
  ].join("\n")

  fs.writeFileSync(absolute, body, { encoding: "utf8" })
}

/** Reads the file back the way Next will, and fails loudly if it does not match. */
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
          key === "GOOGLE_CLIENT_SECRET" || key === "AUTH_URL"
            ? "A `$` in the value is read by Next as a variable reference; escape it as \\$."
            : "This is a bug in auth:setup.",
        ].join("\n")
      )
    }
  }
}

function validateUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`AUTH_URL is not a URL: ${value}`)
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    // Not fatal — AUTH_COOKIE_SECURE=false covers odd setups — but Google will
    // refuse the redirect URI, so say so now rather than at the consent screen.
    process.stderr.write(
      "\nWarning: Google only accepts https redirect URIs, except for localhost. " +
        "Sign-in will fail with redirect_uri_mismatch until AUTH_URL is https.\n"
    )
  }
  return parsed.origin
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const absolute = path.resolve(process.cwd(), options.envPath)
  const existing = readEnvFile(absolute)
  const current = currentValues(existing)

  process.stderr.write(
    `Configuring Google sign-in in ${absolute}\n` +
      "Press Enter to keep the value shown in [brackets].\n\n"
  )

  const prompter = createPrompter()
  const answer = async (key: string, label: string, hide = false) => {
    const fallback = current[key]
    const shown = fallback ? (hide ? " [keep current]" : ` [${fallback}]`) : ""
    const raw = (await (hide ? prompter.hidden : prompter.ask)(`${label}${shown}: `)).trim()
    const value = raw || fallback || ""
    if (!value) throw new Error(`${key} is required. Nothing was changed.`)
    return value
  }

  let values: Record<string, string>
  try {
    const clientId = await answer("GOOGLE_CLIENT_ID", "Google OAuth client ID")
    const clientSecret = await answer("GOOGLE_CLIENT_SECRET", "Google OAuth client secret (hidden)", true)
    const appUrl = validateUrl(await answer("AUTH_URL", "Public URL of this app (e.g. https://finance.example.ts.net)"))
    const allowed = await answer(
      "AUTH_ALLOWED_EMAILS",
      "Google accounts allowed to sign in (comma-separated, or * for anyone)"
    )

    if (!parseAllowedEmails(allowed)) {
      throw new Error("AUTH_ALLOWED_EMAILS has no addresses in it. Nothing was changed.")
    }

    values = {
      // 32 random bytes, so a session cookie cannot be forged by guessing.
      AUTH_SECRET:
        options.rotateSecret || !current.AUTH_SECRET
          ? randomBytes(32).toString("base64")
          : current.AUTH_SECRET,
      GOOGLE_CLIENT_ID: clientId,
      GOOGLE_CLIENT_SECRET: clientSecret,
      AUTH_URL: appUrl,
      AUTH_ALLOWED_EMAILS: allowed,
    }
  } finally {
    prompter.close()
  }

  writeEnvFile(absolute, existing, values)
  verifyRoundTrip(absolute, values)

  process.stderr.write(`\nUpdated ${absolute}\n`)
  if (options.rotateSecret) process.stderr.write("AUTH_SECRET rotated: everyone is signed out.\n")
  process.stderr.write(
    `\nRegister this as an authorized redirect URI on the OAuth client in the\n` +
      `Google Cloud console (APIs & Services → Credentials), exactly:\n\n` +
      `    ${values.AUTH_URL}/api/auth/google/callback\n\n` +
      "Then restart the app.\n"
  )

  if (path.basename(absolute) === ".env") {
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
