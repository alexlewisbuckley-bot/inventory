import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import * as schema from './schema'
import { logger } from '@/lib/logger'

/**
 * Database connection.
 *
 * `node:sqlite` provides the driver (zero dependencies, ships with Node 22+)
 * and Drizzle's `sqlite-proxy` adapter provides the typed query builder.
 * See docs/adr/0001-data-layer.md for why this combination was chosen.
 */

function resolveFile(): string {
  const url = process.env.DATABASE_URL ?? 'file:./data/app.db'
  return url.startsWith('file:') ? url.slice('file:'.length) : url
}

function connect(): DatabaseSync {
  const file = resolveFile()
  const conn = new DatabaseSync(file)
  // WAL dramatically improves concurrent read throughput; foreign_keys is off
  // by default in SQLite and must be enabled per connection.
  conn.exec('PRAGMA journal_mode = WAL')
  conn.exec('PRAGMA foreign_keys = ON')
  conn.exec('PRAGMA busy_timeout = 5000')
  logger.debug('database connected', { file })
  return conn
}

// Next.js recreates modules on hot reload; a global keeps one connection.
const globalForDb = globalThis as unknown as { __sqlite?: DatabaseSync }
export const connection: DatabaseSync = globalForDb.__sqlite ?? connect()
if (process.env.NODE_ENV !== 'production') globalForDb.__sqlite = connection

export const db = drizzle(
  async (query, params, method) => {
    try {
      const stmt = connection.prepare(query)
      if (method === 'run') {
        stmt.run(...(params as never[]))
        return { rows: [] }
      }

      // `sqlite-proxy` maps results positionally, so rows MUST come back as
      // arrays. Object rows are unsafe here: a join that selects the same
      // column name from two tables (`sessions.id` and `users.id`) collapses
      // into a single object key, silently dropping columns and misaligning
      // every value after it. `setReturnArrays` returns the true column
      // vector, duplicates included.
      stmt.setReturnArrays(true)
      const rows = stmt.all(...(params as never[])) as unknown as unknown[][]
      return method === 'get' ? { rows: rows[0] ?? [] } : { rows }
    } catch (error) {
      logger.error('query failed', { query, error: (error as Error).message })
      throw error
    }
  },
  { schema, casing: 'snake_case' },
)

export type Database = typeof db

/**
 * Run `fn` inside a SQLite transaction.
 *
 * `sqlite-proxy` cannot express transactions, so they are driven directly on
 * the underlying connection. Every service performing more than one write must
 * use this — e.g. recording a sale writes to `sales`, `watches` and
 * `audit_logs` and must not half-apply.
 *
 * Nested calls join the outer transaction rather than starting a second one,
 * because SQLite does not support nested BEGIN.
 */
let depth = 0
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (depth > 0) return fn()
  depth += 1
  connection.exec('BEGIN IMMEDIATE')
  try {
    const result = await fn()
    connection.exec('COMMIT')
    return result
  } catch (error) {
    connection.exec('ROLLBACK')
    throw error
  } finally {
    depth -= 1
  }
}

export { schema }
