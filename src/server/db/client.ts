import { AsyncLocalStorage } from 'node:async_hooks'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { logger } from '@/lib/logger'

/**
 * Database connection.
 *
 * Postgres via postgres.js. The application runs on serverless platforms where
 * every instance opens its own pool, so the pool is deliberately small and
 * idle connections are reaped quickly; point `DATABASE_URL` at a pooled
 * endpoint (Neon/Supabase "-pooler", Vercel Postgres, PgBouncer) in production.
 *
 * See docs/adr/0002-postgres.md for why the original SQLite layer was replaced.
 */

/**
 * Query-string parameters that are meaningful to `libpq` and to other ORMs,
 * but which postgres.js forwards to the server as startup configuration.
 *
 * Postgres rejects unknown startup parameters outright, so leaving these in
 * place makes every connection fail with `unrecognized configuration
 * parameter`. Neon's default connection string contains `channel_binding`, and
 * Supabase/Prisma strings commonly carry the rest — so a copy-pasted URL from
 * any of them would otherwise be unusable. TLS is configured explicitly below
 * rather than inferred from `sslmode`.
 */
const CLIENT_ONLY_PARAMS = [
  'channel_binding', 'sslmode', 'connect_timeout', 'pgbouncer',
  'connection_limit', 'pool_timeout', 'schema', 'sslcert', 'sslkey', 'sslrootcert',
]

function connectionString(): string {
  const raw = process.env.DATABASE_URL
  if (!raw) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and point it at your Postgres database.',
    )
  }
  if (raw.startsWith('file:')) {
    throw new Error(
      'DATABASE_URL points at a SQLite file. This application now requires Postgres — ' +
      'see docs/deployment.md. A file-backed database cannot work on serverless hosting.',
    )
  }

  try {
    const url = new URL(raw)
    for (const param of CLIENT_ONLY_PARAMS) url.searchParams.delete(param)
    return url.toString()
  } catch {
    // Not parseable as a URL — hand it to the driver unchanged and let it report.
    return raw
  }
}

function createClient() {
  const url = connectionString()
  return postgres(url, {
    // Serverless: many short-lived instances, each needing very few connections.
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 15,
    // Managed Postgres providers terminate plaintext connections.
    ssl: url.includes('localhost') || url.includes('127.0.0.1') || url.includes('/tmp')
      ? undefined
      : 'require',
    onnotice: () => {},
  })
}

/**
 * The connection is created lazily on first use, never at module scope.
 *
 * ES module imports are hoisted, so anything created at module scope runs
 * before a CLI entrypoint has had a chance to call `loadEnv()` — the seed
 * would then read a DATABASE_URL that was not yet set. Deferring creation
 * until the first query removes that ordering hazard entirely, and also means
 * importing this module in a test never opens a socket.
 */
const globalForDb = globalThis as unknown as {
  __pg?: ReturnType<typeof createClient>
  __db?: PostgresJsDatabase<typeof schema>
}

type Sql = ReturnType<typeof createClient>

function getSql(): Sql {
  if (!globalForDb.__pg) globalForDb.__pg = createClient()
  return globalForDb.__pg
}

function getDb(): PostgresJsDatabase<typeof schema> {
  if (!globalForDb.__db) globalForDb.__db = drizzle(getSql(), { schema, casing: 'snake_case' })
  return globalForDb.__db
}

/** Raw postgres.js tag, for migrations and health checks. */
export const sql = new Proxy((() => {}) as unknown as Sql, {
  apply: (_target, _thisArg, args) => (getSql() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_target, property) => Reflect.get(getSql() as object, property),
}) as Sql

type Tx = Parameters<Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]>[0]

/**
 * Holds the active transaction for the current async context.
 *
 * Services import `db` directly and call it inside `withTransaction`. Binding
 * the transaction here — rather than threading a `tx` argument through every
 * service — means a nested repository call cannot accidentally run outside the
 * transaction its caller opened, which is the classic way a "transactional"
 * write ends up half-applied.
 */
const transactionContext = new AsyncLocalStorage<Tx>()

/**
 * The database handle.
 *
 * Transparently resolves to the active transaction when one is open, and to
 * the pool otherwise.
 */
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, property, receiver) {
    const active = transactionContext.getStore()
    return Reflect.get(active ?? getDb(), property, receiver)
  },
}) as PostgresJsDatabase<typeof schema>

export type Database = typeof db

/**
 * Run `fn` inside a transaction.
 *
 * Nested calls join the outer transaction rather than opening a second one, so
 * a service that calls another transactional service still commits atomically.
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const existing = transactionContext.getStore()
  if (existing) return fn()
  return getDb().transaction(async (tx) => transactionContext.run(tx, fn))
}

/** Verify connectivity and that migrations have been applied. */
export async function checkDatabase(): Promise<{ ok: boolean; migrated: boolean }> {
  try {
    const rows = await sql`
      SELECT to_regclass('public.users') IS NOT NULL AS migrated
    `
    return { ok: true, migrated: Boolean(rows[0]?.migrated) }
  } catch (error) {
    logger.error('database unreachable', { error: (error as Error).message })
    return { ok: false, migrated: false }
  }
}

export { schema }
