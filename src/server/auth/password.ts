import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

interface ScryptOptions { N: number; r: number; p: number; maxmem: number }

const scrypt = promisify(scryptCb) as (
  password: string, salt: Buffer, keylen: number, options: ScryptOptions,
) => Promise<Buffer>

/** Node defaults maxmem to 32 MB; scrypt needs > 128 * N * r bytes. */
const maxmemFor = (N: number, r: number): number => 256 * N * r

/**
 * Password hashing via scrypt (RFC 7914) from Node's standard library.
 *
 * scrypt is memory-hard and is an OWASP-recommended alternative to bcrypt; it
 * needs no third-party dependency, which keeps the auth path free of
 * supply-chain risk. Parameters follow OWASP guidance (N=2^15, r=8, p=1).
 */
const PARAMS = { N: 32768, r: 8, p: 1 } as const
const KEYLEN = 64
const SALT_BYTES = 16

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const derived = await scrypt(password, salt, KEYLEN, { ...PARAMS, maxmem: maxmemFor(PARAMS.N, PARAMS.r) })
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${derived.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, hashB64] = parts
  try {
    const salt = Buffer.from(saltB64!, 'base64')
    const expected = Buffer.from(hashB64!, 'base64')
    const N = Number(n)
    const rr = Number(r)
    const derived = await scrypt(password, salt, expected.length, {
      N, r: rr, p: Number(p), maxmem: maxmemFor(N, rr),
    })
    // Constant-time comparison prevents timing oracles.
    return derived.length === expected.length && timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

export interface PasswordStrength {
  valid: boolean
  score: 0 | 1 | 2 | 3 | 4
  problems: string[]
}

/** Server-side password policy, mirrored by the client for instant feedback. */
export function assessPassword(password: string, context: string[] = []): PasswordStrength {
  const problems: string[] = []
  if (password.length < 10) problems.push('Use at least 10 characters.')
  if (!/[a-z]/.test(password)) problems.push('Include a lowercase letter.')
  if (!/[A-Z]/.test(password)) problems.push('Include an uppercase letter.')
  if (!/[0-9]/.test(password)) problems.push('Include a number.')
  if (/^(.)\1+$/.test(password)) problems.push('Avoid repeating a single character.')
  for (const term of context) {
    if (term && password.toLowerCase().includes(term.toLowerCase().split('@')[0]!)) {
      problems.push('Do not include your name or email address.')
      break
    }
  }
  const bonus = (password.length >= 16 ? 1 : 0) + (/[^A-Za-z0-9]/.test(password) ? 1 : 0)
  const score = Math.max(0, Math.min(4, 4 - problems.length + bonus)) as 0 | 1 | 2 | 3 | 4
  return { valid: problems.length === 0, score, problems }
}
