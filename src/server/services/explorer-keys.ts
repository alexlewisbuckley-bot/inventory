import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { storedSecrets } from '../db/schema'
import { open, seal } from '../auth/secret-box'
import { logger } from '@/lib/logger'
import type { WalletChain } from '@/lib/enums'
import type { SessionUser } from '../auth/session'

/**
 * The keys that let us read a chain.
 *
 * Sealed in the same store as the Anthropic key and for the same reasons: a
 * key in an environment variable is read when the application is built, so
 * changing it does nothing until the next deploy — which is the least
 * obvious of the ways these features stop, because everything looks
 * configured while the running copy holds the old value.
 *
 * These are read-only explorer keys. They let somebody query a public ledger
 * at a higher rate; they cannot sign, spend, or see anything the chain does
 * not already show the world. That is worth saying plainly because "wallet"
 * and "key" in one sentence usually means something far more dangerous.
 *
 * TRON works without one and goes faster with one. Ethereum needs one.
 */

const NAMES: Record<WalletChain, string> = {
  TRON: 'trongrid',
  ETHEREUM: 'etherscan',
}

const ENV: Record<WalletChain, string> = {
  TRON: 'TRONGRID_API_KEY',
  ETHEREUM: 'ETHERSCAN_API_KEY',
}

export interface ExplorerKeyStatus {
  chain: WalletChain
  source: 'stored' | 'environment' | 'none'
  /** Safe to show: enough to tell one key from another, worth nothing alone. */
  hint: string | null
  updatedAt: Date | null
  /** Whether scanning that chain works at all without it. */
  required: boolean
}

/** The last four characters and a length, which is all a screen ever needs. */
export function hintFor(key: string): string {
  return `…${key.slice(-4)} · ${key.length} characters`
}

function fromEnv(chain: WalletChain): string | undefined {
  const value = process.env[ENV[chain]]?.trim()
  return value || undefined
}

/** The key to use for a chain: the stored one first, as it was set last. */
export async function explorerKey(chain: WalletChain): Promise<string | undefined> {
  try {
    const [row] = await db.select({ secret: storedSecrets.secret })
      .from(storedSecrets).where(eq(storedSecrets.name, NAMES[chain])).limit(1)
    if (row) {
      const opened = open(row.secret)
      if (opened) return opened.trim() || undefined
      // Sealed under a different AUTH_SECRET, most likely. Said once, loudly,
      // because the symptom otherwise is a key that silently reverts.
      logger.warn('a stored explorer key could not be opened', { chain })
    }
  } catch (error) {
    // A missing table on an un-migrated deployment must not stop a scan that
    // the environment could have served.
    logger.warn('could not read the stored explorer key', {
      chain, error: error instanceof Error ? error.message : String(error),
    })
  }
  return fromEnv(chain)
}

/** What the settings page may say, without saying the key. */
export async function explorerKeyStatus(): Promise<ExplorerKeyStatus[]> {
  const rows = await db
    .select({ name: storedSecrets.name, secret: storedSecrets.secret, hint: storedSecrets.hint, updatedAt: storedSecrets.updatedAt })
    .from(storedSecrets)
    .where(inArray(storedSecrets.name, Object.values(NAMES)))
    .catch(() => [] as Array<{ name: string; secret: string; hint: string; updatedAt: Date | null }>)

  return (Object.keys(NAMES) as WalletChain[]).map((chain) => {
    const stored = rows.find((row) => row.name === NAMES[chain])
    if (stored && open(stored.secret)) {
      return { chain, source: 'stored' as const, hint: stored.hint, updatedAt: stored.updatedAt, required: chain === 'ETHEREUM' }
    }
    const env = fromEnv(chain)
    return env
      ? { chain, source: 'environment' as const, hint: hintFor(env), updatedAt: null, required: chain === 'ETHEREUM' }
      : { chain, source: 'none' as const, hint: null, updatedAt: null, required: chain === 'ETHEREUM' }
  })
}

/** Store a key, sealed. The value never reaches a page or the audit trail. */
export async function saveExplorerKey(
  chain: WalletChain, key: string, actor: SessionUser,
): Promise<void> {
  const value = key.trim()
  const hint = hintFor(value)
  await db.insert(storedSecrets)
    .values({ name: NAMES[chain], secret: seal(value), hint, updatedBy: actor.id })
    .onConflictDoUpdate({
      target: storedSecrets.name,
      set: { secret: seal(value), hint, updatedBy: actor.id, updatedAt: new Date() },
    })
}

/** Forget a stored key, falling back to the environment variable. */
export async function forgetExplorerKey(chain: WalletChain): Promise<void> {
  await db.delete(storedSecrets).where(eq(storedSecrets.name, NAMES[chain]))
}
