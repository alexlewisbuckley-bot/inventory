import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { db } from '../db/client'
import { watches } from '../db/schema'

/**
 * One asking price from stock, for showing what a rate is worth.
 *
 * A percentage on its own is abstract, and a rate is the whole of what gets
 * agreed with a partner. Against a real price — "a watch at AED 120,000 is
 * AED 110,400 to them" — somebody can see at a glance whether the number
 * they typed is the number they meant.
 *
 * The dearest in-stock piece rather than an average: the arithmetic is linear,
 * so any price demonstrates the rate, and the largest makes a mistyped rate
 * the most obvious. Null when nothing priced is in stock, and the panel simply
 * goes away rather than inventing a figure.
 */
export async function sampleAskingPrice(): Promise<number | null> {
  const [row] = await db.select({ estSaleGbp: watches.estSaleGbp })
    .from(watches)
    .where(and(
      eq(watches.status, 'IN_STOCK'),
      isNull(watches.deletedAt),
      isNotNull(watches.estSaleGbp),
    ))
    .orderBy(desc(watches.estSaleGbp))
    .limit(1)
  return row?.estSaleGbp ?? null
}
