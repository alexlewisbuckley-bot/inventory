import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql as client } from './client'
import { logger } from '@/lib/logger'

/**
 * Forward-only migration runner.
 *
 * Migrations are plain, reviewable `.sql` files applied in filename order and
 * recorded in a `_migrations` ledger. Keeping them as SQL means the exact
 * statements that reach production are the ones that went through code review.
 *
 * Each file runs inside its own transaction, so a failure leaves the database
 * on the last complete migration rather than half-applied.
 */
const DIR = join(process.cwd(), 'src', 'server', 'db', 'migrations')

export async function runMigrations(): Promise<{ applied: string[]; skipped: number }> {
  await client`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `

  const done = new Set(
    (await client<{ name: string }[]>`SELECT name FROM _migrations`).map((row) => row.name),
  )

  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
  const applied: string[] = []

  for (const file of files) {
    if (done.has(file)) continue
    const statements = readFileSync(join(DIR, file), 'utf8')
    try {
      await client.begin(async (tx) => {
        await tx.unsafe(statements)
        await tx`INSERT INTO _migrations (name) VALUES (${file})`
      })
      applied.push(file)
      logger.info('migration applied', { file })
    } catch (error) {
      logger.error('migration failed', { file, error: (error as Error).message })
      throw error
    }
  }

  return { applied, skipped: files.length - applied.length }
}
