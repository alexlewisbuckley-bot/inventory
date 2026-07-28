/** CLI entrypoint: apply any pending SQL migrations, then exit. */
import { loadEnv } from '@/lib/load-env'

loadEnv()

async function main(): Promise<void> {
  const { runMigrations } = await import('./migrate')
  const { sql } = await import('./client')

  try {
    const { applied, skipped } = await runMigrations()
    if (applied.length === 0) console.log(`Database up to date (${skipped} migrations already applied).`)
    else console.log(`Applied ${applied.length} migration(s):\n  ${applied.join('\n  ')}`)
    await sql.end()
    process.exit(0)
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : error)
    await sql.end().catch(() => {})
    process.exit(1)
  }
}

void main()
