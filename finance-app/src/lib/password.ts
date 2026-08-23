/**
 * Password hashing, kept apart from src/lib/auth.ts on purpose.
 *
 * scrypt needs `node:crypto`, which the Edge runtime does not provide, and
 * middleware runs on Edge. Only the login route (`runtime = "nodejs"`) and the
 * setup CLI import this file, so middleware never pulls Node built-ins in.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto"
import { promisify } from "node:util"

// promisify picks the overload without options, so name the one we use.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
) => Promise<Buffer>

// The Node default is N=16384; 2^17 costs ~100ms, which is irrelevant on a
// login that happens once a month and meaningfully slows offline guessing.
const COST = 2 ** 17
const BLOCK_SIZE = 8
const PARALLELIZATION = 1
const KEY_LENGTH = 64
const SALT_LENGTH = 16

const PREFIX = "scrypt"

/**
 * `scrypt$N$r$p$salt$hash`, both parts base64.
 *
 * The parameters travel with the hash so raising the cost later does not
 * invalidate an existing password.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const derived = (await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
    // scrypt at N=2^17 needs ~128 MB; the default 32 MB limit rejects it.
    maxmem: 256 * 1024 * 1024,
  }))

  return [
    PREFIX,
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$")
}

/**
 * Constant-time check of a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash, so a corrupted
 * AUTH_PASSWORD_HASH denies access instead of surfacing a 500 that reveals the
 * value is present but broken.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$")
  if (parts.length !== 6 || parts[0] !== PREFIX) return false

  const [, cost, blockSize, parallelization, saltB64, hashB64] = parts

  const N = Number(cost)
  const r = Number(blockSize)
  const p = Number(parallelization)
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false

  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(saltB64, "base64")
    expected = Buffer.from(hashB64, "base64")
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) return false

  let derived: Buffer
  try {
    derived = (await scryptAsync(password.normalize("NFKC"), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 256 * 1024 * 1024,
    }))
  } catch {
    // An absurd N in a tampered hash makes scrypt throw rather than run.
    return false
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected)
}
