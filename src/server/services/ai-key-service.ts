import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { storedSecrets } from '../db/schema'
import { open, seal } from '../auth/secret-box'
import { describeApiKeyProblem, normaliseApiKey } from '@/lib/anthropic-key'
import { logger } from '@/lib/logger'
import type { SessionUser } from '../auth/session'

/**
 * Where the API key comes from, and how to change it without a deploy.
 *
 * Alex: "Can we add a setting and intsturctions to connect the API key."
 *
 * It could only come from an environment variable, which this host reads
 * when the application is built — so changing it did nothing until the next
 * deploy. That is the least obvious of the three reasons these features
 * stop, because everything looks correctly configured while the running copy
 * holds the old value.
 *
 * A key set here takes effect on the next request. The environment variable
 * still works and is still read, so nothing that is working today stops.
 */

const NAME = 'anthropic'

/** Where the key in use came from, which is the first thing to know. */
export type KeySource = 'stored' | 'environment' | 'none'

export interface KeyStatus {
  source: KeySource
  /** Safe to show: the shared prefix and a length. Null when there is none. */
  hint: string | null
  /** When the stored key was set, for telling "still the old one" from "new". */
  updatedAt: Date | null
}

/**
 * What may be shown about a key.
 *
 * A prefix everybody's key shares and a length — enough to tell one key from
 * another across a deploy, and worth nothing to anybody who reads it. The
 * rest of the value never leaves this module in a form anything renders.
 */
export function hintFor(key: string): string {
  return `sk-ant-… · ${key.length} characters`
}

/**
 * The key to use, stored first.
 *
 * The stored one wins because it is the one somebody set most recently and
 * deliberately, from a screen, knowing the environment variable exists. An
 * unreadable stored key — written under a different AUTH_SECRET, most
 * likely — falls through to the environment rather than taking the features
 * out, which is the kinder failure and the one that can be recovered from
 * without a database.
 */
export async function anthropicKey(): Promise<string | undefined> {
  const stored = await storedKey()
  return stored ?? normaliseApiKey(process.env.ANTHROPIC_API_KEY)
}

export async function anthropicConfigured(): Promise<boolean> {
  return Boolean(await anthropicKey())
}

async function storedKey(): Promise<string | undefined> {
  try {
    const [row] = await db.select({ secret: storedSecrets.secret })
      .from(storedSecrets).where(eq(storedSecrets.name, NAME)).limit(1)
    if (!row) return undefined
    const opened = open(row.secret)
    if (!opened) {
      // Sealed under a different AUTH_SECRET, or truncated. Said once, loudly,
      // because the symptom otherwise is a key that silently reverts.
      logger.warn('the stored Anthropic key could not be opened; falling back to the environment')
      return undefined
    }
    return normaliseApiKey(opened)
  } catch (error) {
    // A missing table on an un-migrated deployment must not take the AI
    // features out: they worked from the environment before this existed.
    logger.warn('could not read the stored Anthropic key', {
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

/** What the settings page may say about the key, without saying the key. */
export async function keyStatus(): Promise<KeyStatus> {
  try {
    const [row] = await db.select({
      secret: storedSecrets.secret, hint: storedSecrets.hint, updatedAt: storedSecrets.updatedAt,
    }).from(storedSecrets).where(eq(storedSecrets.name, NAME)).limit(1)

    if (row && open(row.secret)) {
      return { source: 'stored', hint: row.hint, updatedAt: row.updatedAt }
    }
  } catch {
    // Fall through: the environment is still a real answer.
  }

  const fromEnv = normaliseApiKey(process.env.ANTHROPIC_API_KEY)
  return fromEnv
    ? { source: 'environment', hint: hintFor(fromEnv), updatedAt: null }
    : { source: 'none', hint: null, updatedAt: null }
}

/** Store a key, sealed. The value never goes to the audit trail or a page. */
export async function saveAnthropicKey(key: string, actor: SessionUser): Promise<void> {
  const hint = hintFor(key)
  await db.insert(storedSecrets)
    .values({ name: NAME, secret: seal(key), hint, updatedBy: actor.id })
    .onConflictDoUpdate({
      target: storedSecrets.name,
      set: { secret: seal(key), hint, updatedBy: actor.id, updatedAt: new Date() },
    })
}

/** Forget the stored key, falling back to the environment variable. */
export async function forgetAnthropicKey(): Promise<void> {
  await db.delete(storedSecrets).where(eq(storedSecrets.name, NAME))
}

/**
 * Why the key in use was refused, and where to go and fix it.
 *
 * The second half is new and is the point. With two places a key can live,
 * "the key was rejected" leaves somebody to guess which one is in play —
 * and the commonest mistake is about to be setting it in the one that is
 * being overridden by the other.
 */
export async function describeKeyProblem(): Promise<string> {
  const status = await keyStatus()
  if (status.source === 'none') return 'no key is set, here or on the deployment'

  if (status.source === 'stored') {
    const stored = await storedKey()
    // Stored keys are normalised on the way in, so the entry faults the
    // description knows about cannot apply — what is left is the key itself.
    return `${describeApiKeyProblem(stored)} (set here, in Settings → AI and costs)`
  }
  return `${describeApiKeyProblem(process.env.ANTHROPIC_API_KEY)} (from ANTHROPIC_API_KEY on the deployment — `
    + 'you can set one in Settings → AI and costs instead, which takes effect without a deploy)'
}
