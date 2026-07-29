import { loadEnv } from '@/lib/load-env'

loadEnv()

// eslint-disable-next-line import/first
import { sql as client } from '../client'

/**
 * Synthetic bulk data, for measuring rather than for looking at.
 *
 * The palette has a 100ms budget and there is no honest way to check it
 * against twenty-six watches: `ILIKE '%term%'` over a sequential scan is
 * instant at seed size and unusable at real size, which is precisely the shape
 * of problem that ships. So the suite needs to be able to produce ten times
 * the data on demand — 10,000 watches and 5,000 contacts — and measure there.
 *
 * Deliberately *not* part of `db:seed`. Nobody wants to look at ten thousand
 * fake watches while working, and a demonstration database full of "Synthetic
 * 4412" is a demonstration database nobody trusts. It is opt-in:
 *
 *   npx tsx src/server/db/seed/scale.ts            # 10,000 / 5,000
 *   npx tsx src/server/db/seed/scale.ts 20000 8000
 *   npx tsx src/server/db/seed/scale.ts --clear    # remove it all again
 *
 * Every row it writes is marked — watches by an `SYN-` serial prefix, contacts
 * by a `Z-SYNTH` reference prefix — so `--clear` can remove exactly what this
 * created and nothing a person entered.
 */

const SYNTH_SERIAL = 'SYN-'
const SYNTH_REFERENCE = 'Z-SYNTH-'

const MODELS = [
  'Submariner 126610LN', 'Daytona 126500LN', 'GMT-Master II 126710BLRO',
  'Datejust 41 126334', 'Nautilus 5711/1A', 'Aquanaut 5167A',
  'Royal Oak 15500ST', 'Royal Oak Offshore 26470', 'Speedmaster 310.30.42',
  'Seamaster 210.30.42', 'Big Bang Unico', 'Luminor Marina PAM01312',
]
const SURNAMES = [
  'Almeida', 'Bianchi', 'Chen', 'Duarte', 'Eriksen', 'Fontaine', 'Ghali',
  'Hoffmann', 'Ivanov', 'Jansen', 'Kowalski', 'Lindqvist', 'Moretti',
  'Nakamura', 'Okonkwo', 'Petrov', 'Quintero', 'Rahman', 'Silva', 'Tanaka',
]
const FORENAMES = [
  'Adam', 'Beatriz', 'Cassian', 'Delia', 'Emil', 'Farida', 'Gustav', 'Hana',
  'Idris', 'Jonas', 'Katarina', 'Leon', 'Mira', 'Noor', 'Otto', 'Priya',
]

/**
 * Deterministic pseudo-randomness.
 *
 * A seeded generator rather than Math.random so two runs produce identical
 * data. A latency measurement that moves because the data moved is a
 * measurement of nothing.
 */
function mulberry(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export async function seedScale(watchCount = 10_000, contactCount = 5_000): Promise<void> {
  const random = mulberry(20260729)

  const [brand] = await client<{ id: string }[]>`SELECT id FROM brands ORDER BY name LIMIT 1`
  const [supplier] = await client<{ id: string }[]>`SELECT id FROM suppliers WHERE deleted_at IS NULL LIMIT 1`
  const [location] = await client<{ id: string }[]>`SELECT id FROM locations LIMIT 1`
  const [owner] = await client<{ id: string }[]>`SELECT id FROM users ORDER BY created_at LIMIT 1`
  if (!brand || !supplier || !location || !owner) {
    throw new Error('Run `npm run db:seed` first — the scale set hangs off real reference data.')
  }

  const [{ max }] = await client<{ max: number }[]>`
    SELECT coalesce(max(stock_no), 0)::int AS max FROM watches
  `

  // Batched rather than one statement per row: 10,000 round trips takes minutes
  // and 10,000 rows in batches of 500 takes seconds. Batched rather than one
  // single statement because a 10,000-row VALUES list exceeds what the protocol
  // will carry comfortably.
  const BATCH = 500

  for (let start = 0; start < watchCount; start += BATCH) {
    const rows = []
    for (let i = start; i < Math.min(start + BATCH, watchCount); i += 1) {
      const model = MODELS[Math.floor(random() * MODELS.length)]!
      const cost = 300_000 + Math.floor(random() * 4_000_000)
      rows.push({
        id: `wch_syn${i.toString(36).padStart(9, '0')}`,
        stock_no: max + 1 + i,
        brand_id: brand.id,
        model,
        serial: `${SYNTH_SERIAL}${(i * 7919).toString(36).toUpperCase()}`,
        supplier_id: supplier.id,
        location_id: location.id,
        purchase_price_gbp: cost,
        purchase_price_usd: Math.round(cost * 1.27),
        est_sale_gbp: Math.round(cost * (1.1 + random() * 0.4)),
        purchase_date: new Date(Date.now() - Math.floor(random() * 500) * 86_400_000),
        created_by_id: owner.id,
      })
    }
    await client`
      INSERT INTO watches ${client(rows as never[])}
      ON CONFLICT (id) DO NOTHING
    `
  }

  for (let start = 0; start < contactCount; start += BATCH) {
    const rows = []
    for (let i = start; i < Math.min(start + BATCH, contactCount); i += 1) {
      const first = FORENAMES[Math.floor(random() * FORENAMES.length)]!
      const last = SURNAMES[Math.floor(random() * SURNAMES.length)]!
      rows.push({
        id: `cus_syn${i.toString(36).padStart(9, '0')}`,
        reference: `${SYNTH_REFERENCE}${String(i).padStart(6, '0')}`,
        first_name: first,
        last_name: last,
        company: random() > 0.6 ? `${last} Horology` : null,
        email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.test`,
        // Written the way people actually write them, with punctuation, so the
        // digits-only index is doing real work rather than matching what was
        // already clean.
        phone: `+44 (0)7${String(700_000_000 + i).slice(0, 9)}`,
        customer_type: random() > 0.7 ? 'TRADE' : 'RETAIL',
      })
    }
    await client`
      INSERT INTO customers ${client(rows as never[])}
      ON CONFLICT (id) DO NOTHING
    `
  }

  // The planner will not use a new index until it knows the table changed, and
  // a latency measurement taken against stale statistics measures the wrong
  // plan. This is the difference between 8ms and 400ms on the first run.
  await client`ANALYZE watches`
  await client`ANALYZE customers`
}

export async function clearScale(): Promise<{ watches: number; customers: number }> {
  const watches = await client`DELETE FROM watches WHERE serial LIKE ${`${SYNTH_SERIAL}%`}`
  const customers = await client`DELETE FROM customers WHERE reference LIKE ${`${SYNTH_REFERENCE}%`}`
  await client`ANALYZE watches`
  await client`ANALYZE customers`
  return { watches: watches.count ?? 0, customers: customers.count ?? 0 }
}

if (process.argv[1]?.includes('scale')) {
  const run = async () => {
    if (process.argv.includes('--clear')) {
      const removed = await clearScale()
      console.log(`Removed ${removed.watches} synthetic watches and ${removed.customers} synthetic contacts.`)
      return
    }
    const watchCount = Number(process.argv[2]) || 10_000
    const contactCount = Number(process.argv[3]) || 5_000
    console.log(`Writing ${watchCount} watches and ${contactCount} contacts…`)
    await seedScale(watchCount, contactCount)
    console.log('Done. Remove them again with `--clear`.')
  }
  run()
    .then(async () => { await client.end(); process.exit(0) })
    .catch(async (error) => {
      console.error('Scale seed failed:', error instanceof Error ? error.message : error)
      await client.end().catch(() => {})
      process.exit(1)
    })
}
