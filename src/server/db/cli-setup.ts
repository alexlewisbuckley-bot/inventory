/**
 * Deployment bootstrap: migrate, then seed only if the database is empty.
 *
 * Runs from the Vercel build (see the `vercel-build` script) so a fresh
 * deployment provisions its own schema. Both halves are safe to repeat:
 * migrations are tracked in a ledger, and seeding is skipped entirely once any
 * user exists, so an existing production database is never re-seeded or
 * overwritten by a later build.
 *
 * Production builds only. Preview deployments here share the production
 * DATABASE_URL, so every push to a branch was migrating the live database —
 * once, memorably, leaving the shop half-rebased to dirhams while the site
 * still ran the dollar code. A migration should land when the code that needs
 * it goes live, not when somebody pushes a branch to look at it.
 */
import { loadEnv } from '@/lib/load-env'

loadEnv()

async function main(): Promise<void> {
  // Checked before the client is even imported, so a preview build does not
  // so much as open a connection to it. Unset locally and in CI, which is
  // where this is also run on purpose.
  const target = process.env.VERCEL_ENV
  if (target && target !== 'production') {
    console.log(`\n  ${target} deployment — leaving the database alone.`)
    console.log('  Migrations run on the production build, against the database they belong to.\n')
    return
  }

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
