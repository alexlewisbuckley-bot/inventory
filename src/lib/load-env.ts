import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Load `.env` into `process.env` for CLI entrypoints.
 *
 * Next.js loads `.env` automatically, but scripts run under `tsx` do not — and
 * a mismatch is silently destructive: the seed writes one database while the
 * application reads another. Every CLI entrypoint calls this first so the two
 * can never disagree.
 *
 * Existing environment variables always win, so real deployment config is
 * never overwritten by a checked-in file.
 */
export function loadEnv(file = '.env'): void {
  const path = resolve(process.cwd(), file)
  if (!existsSync(path)) return

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator === -1) continue
    const key = trimmed.slice(0, separator).trim()
    if (key in process.env) continue
    process.env[key] = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '')
  }
}
