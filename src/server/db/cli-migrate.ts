/** CLI entrypoint: apply any pending SQL migrations. */
import { runMigrations } from './migrate'

const { applied, skipped } = runMigrations()
if (applied.length === 0) console.log(`Database up to date (${skipped} migrations already applied).`)
else console.log(`Applied ${applied.length} migration(s):\n  ${applied.join('\n  ')}`)
process.exit(0)
