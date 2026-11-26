import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { onHandStock } from '../db/predicates'
import { db } from '../db/client'
import { brands, partnerAgents, partners, watches } from '../db/schema'
import { partnerPrice } from '@/lib/partner-rate'

/** A watch an agent may choose, at the price their employer negotiated. */
export interface AgentChoice {
  id: string
  brandName: string
  model: string | null
  modelName: string | null
  year: number | null
  dial: string | null
  caseSizeMm: number | null
  priceBase: number
  imageIds: string[]
}

/**
 * What one agent may choose from, inside the cap they have unlocked.
 *
 * The same stock the portal shows and the same rule: on the books here, in
 * stock, with a photograph. Priced at the partner's own rate, because the
 * cap is a figure the company set against what it pays us — measuring
 * against the asking price would quietly hand back the discount it
 * negotiated, which is the mistake the campaign budget already learnt.
 *
 * The cap is applied in SQL rather than after, so a page cannot be made to
 * list the whole case by asking for a large one.
 */
export async function stockForAgent(token: string, capBase: number): Promise<AgentChoice[]> {
  if (!token || token.length < 16 || capBase <= 0) return []

  const [agent] = await db
    .select({ partnerId: partnerAgents.partnerId, discountBps: partners.discountBps })
    .from(partnerAgents)
    .innerJoin(partners, eq(partners.id, partnerAgents.partnerId))
    .where(and(
      eq(partnerAgents.token, token),
      eq(partnerAgents.isActive, true),
      isNull(partnerAgents.deletedAt),
    ))
    .limit(1)
  if (!agent) return []

  const rows = await db
    .select({
      id: watches.id,
      brandName: brands.name,
      model: watches.model,
      modelName: watches.modelName,
      year: watches.year,
      dial: watches.dial,
      caseSizeMm: watches.caseSizeMm,
      askingBase: watches.estSaleGbp,
      tradeBase: watches.tradePriceGbp,
      imageIds: sql<string[]>`coalesce((
        SELECT array_agg(i.id ORDER BY i.sort_order, i.created_at)
        FROM watch_images i WHERE i.watch_id = watches.id AND i.kind = 'WATCH'
      ), ARRAY[]::text[])`,
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .where(and(
      eq(watches.status, 'IN_STOCK'),
      isNull(watches.deletedAt),
      sql`${watches.estSaleGbp} IS NOT NULL`,
      onHandStock(),
      sql`EXISTS (
        SELECT 1 FROM watch_images i
        WHERE i.watch_id = watches.id AND i.kind = 'WATCH'
      )`,
    ))
    .orderBy(asc(watches.estSaleGbp))

  return rows
    .map((row) => ({
      id: row.id,
      brandName: row.brandName,
      model: row.model,
      modelName: row.modelName,
      year: row.year,
      dial: row.dial,
      caseSizeMm: row.caseSizeMm,
      priceBase: partnerPrice(row.askingBase, agent.discountBps, row.tradeBase) ?? 0,
      imageIds: row.imageIds,
    }))
    .filter((row) => row.priceBase > 0 && row.priceBase <= capBase)
}

/**
 * A photograph, behind the agent's own link.
 *
 * The id alone is not enough: it has to belong to a watch this agent could
 * actually be shown. Otherwise the route is a way to read any photograph in
 * the system by guessing ids, from a link somebody was sent in January.
 *
 * Scoped to the live, on-the-books stock rather than to their cap, so the
 * picture of the watch they chose in March still loads in November when they
 * have climbed past it.
 */
export async function agentImage(token: string, imageId: string) {
  if (!token || token.length < 16 || !imageId) return null

  const { watchImages } = await import('../db/schema')
  const [row] = await db
    .select({ data: watchImages.data, mimeType: watchImages.mimeType, byteSize: watchImages.byteSize })
    .from(watchImages)
    .innerJoin(watches, eq(watches.id, watchImages.watchId))
    .innerJoin(partnerAgents, and(
      eq(partnerAgents.token, token),
      eq(partnerAgents.isActive, true),
      isNull(partnerAgents.deletedAt),
    ))
    .where(and(
      eq(watchImages.id, imageId),
      eq(watchImages.kind, 'WATCH'),
      isNull(watches.deletedAt),
      onHandStock(),
    ))
    .limit(1)
  return row ?? null
}

/** The partner's own mark, for the top of the agent's page. */
export async function agentLogo(token: string) {
  if (!token || token.length < 16) return null
  const [row] = await db
    .select({ data: partners.logoData, mimeType: partners.logoMime })
    .from(partnerAgents)
    .innerJoin(partners, eq(partners.id, partnerAgents.partnerId))
    .where(and(
      eq(partnerAgents.token, token),
      eq(partnerAgents.isActive, true),
      isNull(partnerAgents.deletedAt),
      sql`${partners.logoData} is not null`,
    ))
    .limit(1)
  return row?.data ? { data: row.data, mimeType: row.mimeType ?? 'image/png' } : null
}
