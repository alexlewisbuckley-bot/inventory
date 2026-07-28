/**
 * Deployment bootstrap: migrate, then seed only if the database is empty.
 *
 * Runs from the Vercel build (see the `vercel-build` script) so a fresh
 * deployment provisions its own schema. Both halves are safe to repeat:
 * migrations are tracked in a ledger, and seeding is skipped entirely once any
 * user exists, so an existing production database is never re-seeded or
 * overwritten by a later build.
 */
import { loadEnv } from '@/lib/load-env'

loadEnv()

async function main(): Promise<void> {
  const { sql } = await import('./client')

  if (!process.env.DATABASE_URL) {
    console.error('\n  DATABASE_URL is not set — skipping database setup.')
    console.error('  The build will continue, but the application cannot serve requests.\n')
    process.exit(1)
  }

  try {
    const { runMigrations } = await import('./migrate')
    const { applied, skipped } = await runMigrations()
    console.log(
      applied.length > 0
        ? `  Applied ${applied.length} migration(s): ${applied.join(', ')}`
        : `  Schema up to date (${skipped} migration(s) already applied).`,
    )

    const [{ count }] = await sql<{ count: string }[]>`SELECT COUNT(*)::text AS count FROM users`
    if (Number(count) > 0) {
      console.log(`  Database already has ${count} user(s) — skipping seed.`)
    } else {
      console.log('  Empty database detected — seeding reference data and starting stock…')
      const { seed } = await import('./seed/index')
      await seed()
      const [{ watches }] = await sql<{ watches: string }[]>`SELECT COUNT(*)::text AS watches FROM watches`
      console.log(`  Seeded ${watches} watches. Sign in with alex@bluecroft.co.uk / Bluecroft2026!`)
      console.log('  CHANGE THAT PASSWORD after your first sign-in.')
    }

    await sql.end()
    process.exit(0)
  } catch (error) {
    console.error('\n  Database setup failed:', error instanceof Error ? error.message : error)
    console.error('  Check that DATABASE_URL points at a reachable Postgres database.\n')
    await sql.end().catch(() => {})
    process.exit(1)
  }
}

void main()
