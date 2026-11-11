import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

/**
 * Secrets the application is trusted to hold, encrypted at rest.
 *
 * The first of these is the Anthropic API key, which Alex asked to be able
 * to set from the application rather than from the hosting dashboard —
 * because a key set there does nothing until the next deploy, which is one
 * of the three reasons the AI features kept stopping.
 *
 * Storing a key that can spend money as plain text in a table is not the
 * same thing as storing it in an environment variable, even though both are
 * readable by anybody holding the server. A database is copied: into
 * backups, into a staging dump somebody takes to reproduce a bug, into the
 * hands of whoever is handed a restore file. Encrypting it means those
 * copies carry nothing usable on their own.
 *
 * It is not a vault, and it does not pretend to be. AUTH_SECRET is on the
 * same machine, so an attacker who has the running server has both halves.
 * What this defends against is the copy that leaves the machine, which is
 * the way secrets in small systems actually get out.
 */

/**
 * The encryption key, derived rather than used directly.
 *
 * AUTH_SECRET is a password, not a key: it can be any length and has
 * unknown entropy per character. scrypt turns it into the 32 bytes AES-256
 * requires, and does so slowly enough that the derivation is not itself a
 * way to test guesses at AUTH_SECRET.
 *
 * The salt is fixed and public. A random salt would have to be stored
 * alongside each secret and would buy nothing here: there is one password,
 * not a table of user passwords for which a rainbow table is the threat.
 */
const SALT = 'bluecroft.secret-box.v1'

function key(): Buffer {
  const secret = process.env.AUTH_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET must be set to at least 32 characters before a secret can be stored.')
  }
  return scryptSync(secret, SALT, 32)
}

/** Marks the scheme, so a later one can be told apart rather than guessed at. */
const VERSION = 'v1'

/**
 * Encrypt, in a form that carries everything needed to decrypt it but the key.
 *
 * AES-256-GCM rather than CBC: it authenticates as well as encrypts, so a
 * tampered row fails to open instead of opening onto something else. The
 * nonce is random per secret and stored beside the ciphertext, which is what
 * it is for — it is not secret, it only has to be unique.
 */
export function seal(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.')
}

/**
 * Decrypt, or null.
 *
 * Null rather than a throw, for every way this can fail: a row written
 * under a different AUTH_SECRET, a truncated value, a scheme this build does
 * not know. The caller's job is then "there is no usable key", which is a
 * state it already has to handle, rather than an exception on a page that
 * was only trying to say whether a feature is switched on.
 */
export function open(sealed: string | null | undefined): string | null {
  if (!sealed) return null
  const [version, iv, tag, body] = sealed.split('.')
  if (version !== VERSION || !iv || !tag || !body) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
