import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { connection } from './client'
import { logger } from '@/lib/logger'

/**
 * Minimal forward-only migration runner.
 *
 * Migrations are plain `.sql` files applied in lexical filename order and
 * recorded in `_migrations`. Keeping them as reviewable SQL (rather than
 * generated at runtime) means the exact statements that will hit production
 * are the ones in code review.
 */
const DIR = join(process.cwd(), 'src', 'server', 'db', 'migrations')

export function runMigrations(): { applied: string[]; skipped: number } {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `)

  const done = new Set(
    (connection.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name),
  )

  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
  const applied: string[] = []

  for (const file of files) {
    if (done.has(file)) continue
    const sql = readFileSync(join(DIR, file), 'utf8')
    connection.exec('BEGIN IMMEDIATE')
    try {
      connection.exec(sql)
      connection.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(file, Date.now())
      connection.exec('COMMIT')
      applied.push(file)
      logger.info('migration applied', { file })
    } catch (error) {
      connection.exec('ROLLBACK')
      logger.error('migration failed', { file, error: (error as Error).message })
      throw error
    }
  }

  return { applied, skipped: files.length - applied.length }
}
