import { loadEnv } from '@/lib/load-env'

loadEnv()

// eslint-disable-next-line import/first
import { and, eq, isNull, like, or } from 'drizzle-orm'
// eslint-disable-next-line import/first
import { db, sql as client } from '@/server/db/client'
// eslint-disable-next-line import/first
import { sales, users, watches } from '@/server/db/schema'
// eslint-disable-next-line import/first
import { voidSale } from '@/server/services/watch-service'

/**
 * Put the fixture back.
 *
 *   npm run test:restock
 *
 * The journey suite sells watches. Most journeys now void what they sold, but
 * a run that fails part-way leaves a sale behind, and enough of those turn a
 * demonstration database of twenty-six watches into a database of two — at
 * which point the money journeys fail with "nothing is in stock to sell",
 * which reads as a product fault and is not one.
 *
 * This voids every sale the suite created — invoices prefixed INV-J-, INV-L-
 * or INV-R-, which only the journeys ever write — through the application's
 * own service, so the audit trail, the stock movement and the deal linkage
 * unwind exactly as they would if a person had done it. A direct UPDATE would
 * be quicker and would leave the database in a state the application itself
 * can never produce, which is the worst kind of fixture to test against.
 */
async function main(): Promise<void> {
  const [actor] = await db.select().from(users).orderBy(users.createdAt).limit(1)
  if (!actor) throw new Error('No users — run `npm run db:seed` first.')

  const rows = await db
    .select({ watchId: sales.watchId, invoiceNo: sales.invoiceNo })
    .from(sales)
    .where(and(
      isNull(sales.voidedAt),
      isNull(sales.deletedAt),
      or(
        like(sales.invoiceNo, 'INV-J-%'),
        like(sales.invoiceNo, 'INV-L-%'),
        like(sales.invoiceNo, 'INV-R-%'),
      ),
    ))

  let restored = 0
  for (const row of rows) {
    try {
      await voidSale(row.watchId, 'Restocked by tests/harness/restock.ts', actor as never)
      restored += 1
    } catch (error) {
      console.warn(`could not void ${row.invoiceNo}: ${(error as Error).message}`)
    }
  }

  const inStock = await db.select({ id: watches.id }).from(watches)
    .where(and(isNull(watches.deletedAt), eq(watches.status, 'IN_STOCK')))

  console.log(`Voided ${restored} journey sale(s). ${inStock.length} watches in stock.`)
}

main()
  .then(async () => { await client.end(); process.exit(0) })
  .catch(async (error: Error) => {
    console.error(error.message)
    await client.end().catch(() => {})
    process.exit(1)
  })
