import { randomBytes } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import {
  brands, notifications, partnerCampaignItems, partnerCampaignRecipients, partnerCampaigns,
  partnerOrders, partners, users, watchImages, watches,
} from '../db/schema'
import { recordAudit } from './audit'
import { newId } from '@/lib/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { partnerPrice } from '@/lib/partner-rate'
import { logger } from '@/lib/logger'
import { sendWhatsApp } from './whatsapp'
import type { CampaignKind } from '@/lib/enums'

/**
 * Reward campaigns a partner runs for its own people.
 *
 * A company sets one up in its portal and sends each person a link. The person
 * picks a watch; we get a hold and a phone call to make. Everything below the
 * choosing is step two's machinery — an order, a hold, a notification — so a
 * campaign claim and a partner's own order end up in the same held-stock list
 * and are released the same way.
 */

/**
 * The secret in a recipient's link.
 *
 * 32 random characters from a 256-bit source, one per person. This is the
 * whole of the access control on a page that shows a handful of watches at a
 * negotiated price, so it is generated the way a session token is rather than
 * derived from somebody's name — which would make every colleague's link
 * guessable from your own.
 */
function newRecipientToken(): string {
  return randomBytes(24).toString('base64url').slice(0, 32)
}

export interface CampaignInput {
  name: string
  intro?: string | null
  kind: CampaignKind
  /** Base minor units, for a BUDGET campaign. */
  budgetBase?: number | null
}

/**
 * A budget is checked where it is set, not only where it is spent.
 *
 * A BUDGET campaign with no amount would show every watch in the building to
 * somebody's sales assistant — the filter that keeps a campaign inside its
 * budget is the budget, and a missing one filters nothing.
 */
function assertBudget(input: CampaignInput): void {
  if (input.kind !== 'BUDGET') return
  if (!input.budgetBase || input.budgetBase <= 0) {
    throw new ValidationError('That campaign needs an amount.', {
      budget: 'Say what each person can spend.',
    })
  }
}

export async function listCampaigns(partnerId: string) {
  return db
    .select({
      id: partnerCampaigns.id,
      name: partnerCampaigns.name,
      intro: partnerCampaigns.intro,
      kind: partnerCampaigns.kind,
      budgetBase: partnerCampaigns.budgetBase,
      status: partnerCampaigns.status,
      createdAt: partnerCampaigns.createdAt,
      recipientCount: sql<number>`(
        SELECT count(*) FROM partner_campaign_recipients r
        WHERE r.campaign_id = partner_campaigns.id AND r.deleted_at IS NULL
      )`,
      claimedCount: sql<number>`(
        SELECT count(*) FROM partner_campaign_recipients r
        WHERE r.campaign_id = partner_campaigns.id AND r.deleted_at IS NULL
          AND r.claimed_at IS NOT NULL
      )`,
      itemCount: sql<number>`(
        SELECT count(*) FROM partner_campaign_items i
        WHERE i.campaign_id = partner_campaigns.id
      )`,
    })
    .from(partnerCampaigns)
    .where(and(eq(partnerCampaigns.partnerId, partnerId), isNull(partnerCampaigns.deletedAt)))
    .orderBy(desc(partnerCampaigns.createdAt))
}

export async function getCampaign(partnerId: string, campaignId: string) {
  const [found] = await db.select().from(partnerCampaigns)
    .where(and(
      eq(partnerCampaigns.id, campaignId),
      // Scoped by partner, always. A campaign id is guessable in a way a token
      // is not, and one company must never reach another's reward scheme.
      eq(partnerCampaigns.partnerId, partnerId),
      isNull(partnerCampaigns.deletedAt),
    ))
    .limit(1)
  if (!found) throw new NotFoundError('Campaign')
  return found
}

export async function createCampaign(partnerId: string, input: CampaignInput): Promise<string> {
  assertBudget(input)
  const name = input.name.trim()
  if (!name) throw new ValidationError('That campaign needs a name.', { name: 'Give it a name.' })

  const id = newId('cmp')
  await db.insert(partnerCampaigns).values({
    id,
    partnerId,
    name,
    intro: input.intro?.trim() || null,
    kind: input.kind,
    budgetBase: input.kind === 'BUDGET' ? input.budgetBase ?? null : null,
    status: 'DRAFT',
  })

  await recordAudit({
    entityType: 'PartnerCampaign', entityId: id, action: 'CREATE', actorId: null,
    summary: `Campaign "${name}" created`,
  })
  return id
}

export async function updateCampaign(
  partnerId: string,
  campaignId: string,
  input: CampaignInput,
): Promise<void> {
  assertBudget(input)
  const before = await getCampaign(partnerId, campaignId)
  // A closed campaign is history. Editing one would rewrite what people were
  // told they could choose from, after they chose.
  if (before.status === 'CLOSED') throw new ConflictError('That campaign has closed.')

  await db.update(partnerCampaigns).set({
    name: input.name.trim(),
    intro: input.intro?.trim() || null,
    kind: input.kind,
    budgetBase: input.kind === 'BUDGET' ? input.budgetBase ?? null : null,
    updatedAt: new Date(),
  }).where(eq(partnerCampaigns.id, campaignId))
}

/**
 * Open a campaign, so its links start working.
 *
 * Checked rather than taken on trust, because the two ways a campaign goes out
 * broken are both silent: a shortlist with nothing on it, and a campaign with
 * nobody to send it to. Both produce a link that opens an empty page, and the
 * person who gets it concludes the company forgot about them.
 */
export async function openCampaign(partnerId: string, campaignId: string): Promise<void> {
  const campaign = await getCampaign(partnerId, campaignId)
  if (campaign.status === 'CLOSED') throw new ConflictError('That campaign has closed.')

  const [recipients] = await db.select({ value: sql<number>`count(*)` })
    .from(partnerCampaignRecipients)
    .where(and(
      eq(partnerCampaignRecipients.campaignId, campaignId),
      isNull(partnerCampaignRecipients.deletedAt),
    ))
  if (Number(recipients?.value ?? 0) === 0) {
    throw new ValidationError('Nobody is on this campaign yet.')
  }

  if (campaign.kind === 'SHORTLIST') {
    const [items] = await db.select({ value: sql<number>`count(*)` })
      .from(partnerCampaignItems)
      .where(eq(partnerCampaignItems.campaignId, campaignId))
    if (Number(items?.value ?? 0) === 0) {
      throw new ValidationError('There are no watches on this shortlist yet.')
    }
  }

  await db.update(partnerCampaigns)
    .set({ status: 'OPEN', openedAt: new Date(), updatedAt: new Date() })
    .where(eq(partnerCampaigns.id, campaignId))

  await recordAudit({
    entityType: 'PartnerCampaign', entityId: campaignId, action: 'UPDATE', actorId: null,
    summary: `Campaign "${campaign.name}" opened`,
  })
}

/**
 * Close it.
 *
 * Every unclaimed link stops working; holds already placed are untouched. A
 * campaign closing must not release a watch somebody chose last week — that
 * decision belongs to a person on the held-stock list, as every other release
 * does.
 */
export async function closeCampaign(partnerId: string, campaignId: string): Promise<void> {
  const campaign = await getCampaign(partnerId, campaignId)
  await db.update(partnerCampaigns)
    .set({ status: 'CLOSED', closedAt: new Date(), updatedAt: new Date() })
    .where(eq(partnerCampaigns.id, campaignId))

  await recordAudit({
    entityType: 'PartnerCampaign', entityId: campaignId, action: 'UPDATE', actorId: null,
    summary: `Campaign "${campaign.name}" closed`,
  })
}

/** Soft, so a campaign that was sent out still reads back afterwards. */
export async function deleteCampaign(partnerId: string, campaignId: string): Promise<void> {
  const campaign = await getCampaign(partnerId, campaignId)
  await db.update(partnerCampaigns)
    .set({ deletedAt: new Date(), status: 'CLOSED', updatedAt: new Date() })
    .where(eq(partnerCampaigns.id, campaignId))
  await recordAudit({
    entityType: 'PartnerCampaign', entityId: campaignId, action: 'DELETE', actorId: null,
    summary: `Campaign "${campaign.name}" removed`,
  })
}

export async function addRecipients(
  partnerId: string,
  campaignId: string,
  people: Array<{ name: string; email?: string | null }>,
): Promise<number> {
  await getCampaign(partnerId, campaignId)
  const rows = people
    .map((person) => ({ name: person.name.trim(), email: person.email?.trim() || null }))
    .filter((person) => person.name.length > 0)
  if (rows.length === 0) throw new ValidationError('Nobody was added.', { people: 'Give at least one name.' })

  await db.insert(partnerCampaignRecipients).values(rows.map((person) => ({
    id: newId('rcp'),
    campaignId,
    name: person.name,
    email: person.email,
    token: newRecipientToken(),
  })))
  return rows.length
}

export async function removeRecipient(
  partnerId: string,
  campaignId: string,
  recipientId: string,
): Promise<void> {
  await getCampaign(partnerId, campaignId)
  const [person] = await db.select().from(partnerCampaignRecipients)
    .where(and(
      eq(partnerCampaignRecipients.id, recipientId),
      eq(partnerCampaignRecipients.campaignId, campaignId),
    ))
    .limit(1)
  if (!person) throw new NotFoundError('Recipient')
  /*
   * Somebody who has already chosen cannot be taken off.
   *
   * Their choice is a hold on a watch and a row on our held-stock list.
   * Removing the person would leave that hold with nothing explaining it, and
   * the way to undo a claim is to release the hold — which is a decision
   * somebody here takes, with a reason, on the list where it is visible.
   */
  if (person.claimedAt) throw new ConflictError('They have already chosen. Release the hold instead.')

  await db.update(partnerCampaignRecipients)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(partnerCampaignRecipients.id, recipientId))
}

export async function listRecipients(partnerId: string, campaignId: string) {
  await getCampaign(partnerId, campaignId)
  return db
    .select({
      id: partnerCampaignRecipients.id,
      name: partnerCampaignRecipients.name,
      email: partnerCampaignRecipients.email,
      token: partnerCampaignRecipients.token,
      claimedAt: partnerCampaignRecipients.claimedAt,
      claimNote: partnerCampaignRecipients.claimNote,
      chosenBrand: brands.name,
      chosenModel: watches.model,
      chosenModelName: watches.modelName,
    })
    .from(partnerCampaignRecipients)
    .leftJoin(partnerOrders, eq(partnerOrders.id, partnerCampaignRecipients.claimedOrderId))
    .leftJoin(watches, eq(watches.id, partnerOrders.watchId))
    .leftJoin(brands, eq(brands.id, watches.brandId))
    .where(and(
      eq(partnerCampaignRecipients.campaignId, campaignId),
      isNull(partnerCampaignRecipients.deletedAt),
    ))
    .orderBy(asc(partnerCampaignRecipients.createdAt))
}

export async function setShortlist(
  partnerId: string,
  campaignId: string,
  watchIds: string[],
): Promise<void> {
  const campaign = await getCampaign(partnerId, campaignId)
  if (campaign.status === 'CLOSED') throw new ConflictError('That campaign has closed.')

  await withTransaction(async () => {
    await db.delete(partnerCampaignItems).where(eq(partnerCampaignItems.campaignId, campaignId))
    if (watchIds.length === 0) return
    await db.insert(partnerCampaignItems).values(watchIds.map((watchId, index) => ({
      id: newId('cit'),
      campaignId,
      watchId,
      sortOrder: index,
    })))
  })
}

export interface RecipientView {
  recipient: { id: string; name: string; claimedAt: Date | null }
  campaign: {
    id: string
    name: string
    intro: string | null
    kind: CampaignKind
    budgetBase: number | null
    partnerName: string
    brandColor: string
    accentColor: string
    discountBps: number
  }
  choices: Array<{
    id: string
    brandName: string
    model: string | null
    modelName: string | null
    year: number | null
    caseSizeMm: number | null
    dial: string | null
    boxPapers: string | null
    condition: string | null
    priceGbp: number
    imageIds: string[]
  }>
  chosen: {
    brandName: string
    model: string | null
    modelName: string | null
  } | null
}

/**
 * What one person sees when they open their link.
 *
 * Null for anything that is not a live invitation — an unknown token, a draft,
 * a closed campaign, a deleted recipient. All the same nothing, because
 * anything more specific tells whoever holds a dead link that there is
 * something real behind it.
 */
export async function getRecipientView(token: string): Promise<RecipientView | null> {
  if (!token || token.length < 16) return null

  const rows = await db
    .select({
      recipientId: partnerCampaignRecipients.id,
      recipientName: partnerCampaignRecipients.name,
      claimedAt: partnerCampaignRecipients.claimedAt,
      claimedOrderId: partnerCampaignRecipients.claimedOrderId,
      campaignId: partnerCampaigns.id,
      campaignName: partnerCampaigns.name,
      intro: partnerCampaigns.intro,
      kind: partnerCampaigns.kind,
      budgetBase: partnerCampaigns.budgetBase,
      status: partnerCampaigns.status,
      partnerId: partners.id,
      partnerName: partners.name,
      partnerDisplayName: partners.displayName,
      brandColor: partners.brandColor,
      accentColor: partners.accentColor,
      discountBps: partners.discountBps,
    })
    .from(partnerCampaignRecipients)
    .innerJoin(partnerCampaigns, eq(partnerCampaigns.id, partnerCampaignRecipients.campaignId))
    .innerJoin(partners, eq(partners.id, partnerCampaigns.partnerId))
    .where(and(
      eq(partnerCampaignRecipients.token, token),
      isNull(partnerCampaignRecipients.deletedAt),
      isNull(partnerCampaigns.deletedAt),
      isNull(partners.deletedAt),
      eq(partners.isActive, true),
    ))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  // A draft link that works is a half-built campaign sent out by accident; a
  // closed one still giving away stock is a campaign that never ended.
  if (row.status !== 'OPEN') return null

  const chosen = row.claimedOrderId
    ? (await db.select({
        brandName: brands.name,
        model: watches.model,
        modelName: watches.modelName,
      })
        .from(partnerOrders)
        .innerJoin(watches, eq(watches.id, partnerOrders.watchId))
        .innerJoin(brands, eq(brands.id, watches.brandId))
        .where(eq(partnerOrders.id, row.claimedOrderId))
        .limit(1))[0] ?? null
    : null

  return {
    recipient: { id: row.recipientId, name: row.recipientName, claimedAt: row.claimedAt },
    campaign: {
      id: row.campaignId,
      name: row.campaignName,
      intro: row.intro,
      kind: row.kind as CampaignKind,
      budgetBase: row.budgetBase,
      partnerName: row.partnerDisplayName || row.partnerName,
      brandColor: row.brandColor,
      accentColor: row.accentColor,
      discountBps: row.discountBps,
    },
    choices: row.claimedAt ? [] : await choicesFor({
      campaignId: row.campaignId,
      kind: row.kind as CampaignKind,
      budgetBase: row.budgetBase,
      discountBps: row.discountBps,
    }),
    chosen: chosen ?? null,
  }
}

/**
 * What this campaign puts in front of somebody.
 *
 * A shortlist shows what their employer picked. A budget shows everything they
 * can actually afford at the partner's rate — measured against the partner's
 * price, not the asking price, because their rate is the arrangement and
 * measuring the other way would quietly hand back the discount the company
 * negotiated.
 *
 * Held stock is absent from both, by the same rule as the portal: a piece
 * somebody else has taken is gone rather than greyed out. Here it matters
 * more, not less — a colleague's reward showing as "reserved" tells one
 * employee what another one chose.
 */
async function choicesFor(campaign: {
  campaignId: string
  kind: CampaignKind
  budgetBase: number | null
  discountBps: number
}) {
  const live = [
    eq(watches.status, 'IN_STOCK'),
    isNull(watches.deletedAt),
    sql`${watches.estSaleGbp} IS NOT NULL`,
    sql`EXISTS (
      SELECT 1 FROM watch_images i
      WHERE i.watch_id = watches.id AND i.kind = 'WATCH'
    )`,
  ]

  const rows = await db
    .select({
      id: watches.id,
      brandName: brands.name,
      model: watches.model,
      modelName: watches.modelName,
      year: watches.year,
      caseSizeMm: watches.caseSizeMm,
      dial: watches.dial,
      boxPapers: watches.boxPapers,
      condition: watches.condition,
      askingGbp: watches.estSaleGbp,
      imageIds: sql<string[]>`coalesce((
        SELECT array_agg(i.id ORDER BY i.sort_order, i.created_at)
        FROM watch_images i WHERE i.watch_id = watches.id AND i.kind = 'WATCH'
      ), ARRAY[]::text[])`,
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .where(campaign.kind === 'SHORTLIST'
      ? and(
        ...live,
        inArray(watches.id, db.select({ id: partnerCampaignItems.watchId })
          .from(partnerCampaignItems)
          .where(eq(partnerCampaignItems.campaignId, campaign.campaignId))),
      )
      : and(...live))
    .orderBy(asc(brands.name), asc(watches.model))

  return rows
    .map((row) => ({
      ...row,
      priceGbp: partnerPrice(row.askingGbp, campaign.discountBps) as number,
    }))
    .filter((row) => campaign.kind !== 'BUDGET'
      || (campaign.budgetBase !== null && row.priceGbp <= campaign.budgetBase))
}

/**
 * Somebody chooses.
 *
 * One watch each, and it goes on hold in the company's name with the person's
 * name on the order. Everything after this is step two's: the piece leaves
 * every list it was on, our team is told, and a human releases it if it comes
 * to nothing.
 */
export async function claim(
  token: string,
  watchId: string,
  note: string | null,
): Promise<void> {
  const view = await getRecipientView(token)
  if (!view) throw new NotFoundError('Invitation')
  if (view.recipient.claimedAt) throw new ConflictError('You have already chosen.')

  // Checked against the campaign's own list rather than against the watch id
  // that came back with the form. Otherwise a budget campaign is a way to
  // order any watch in the building by editing one field.
  const choice = view.choices.find((row) => row.id === watchId)
  if (!choice) throw new ValidationError('That one is no longer available.')

  await withTransaction(async () => {
    const [watch] = await db.select({
      id: watches.id,
      stockNo: watches.stockNo,
      status: watches.status,
      version: watches.version,
      askingGbp: watches.estSaleGbp,
    }).from(watches).where(eq(watches.id, watchId)).limit(1)

    if (!watch || watch.status !== 'IN_STOCK' || watch.askingGbp === null) {
      throw new ConflictError('That one has just gone.')
    }

    const [partner] = await db.select({ id: partners.id, name: partners.name, discountBps: partners.discountBps })
      .from(partnerCampaigns)
      .innerJoin(partners, eq(partners.id, partnerCampaigns.partnerId))
      .where(eq(partnerCampaigns.id, view.campaign.id))
      .limit(1)
    if (!partner) throw new NotFoundError('Partner')

    const price = partnerPrice(watch.askingGbp, partner.discountBps)
    if (price === null) throw new ConflictError('That one has just gone.')

    const orderId = newId('pord')
    await db.insert(partnerOrders).values({
      id: orderId,
      partnerId: partner.id,
      watchId: watch.id,
      askingAtOrder: watch.askingGbp,
      discountBpsAtOrder: partner.discountBps,
      priceAtOrder: price,
      placedByName: view.recipient.name,
      note: note?.trim() || null,
      status: 'PLACED',
      campaignId: view.campaign.id,
      recipientId: view.recipient.id,
    })

    await db.update(partnerCampaignRecipients)
      .set({
        claimedOrderId: orderId,
        claimedAt: new Date(),
        claimNote: note?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(partnerCampaignRecipients.id, view.recipient.id))

    await db.update(watches)
      .set({ status: 'RESERVED', updatedAt: new Date(), version: watch.version + 1 })
      .where(eq(watches.id, watch.id))

    await recordAudit({
      entityType: 'Watch', entityId: watch.id, action: 'UPDATE', actorId: null,
      summary: `Stock ${watch.stockNo} chosen by ${view.recipient.name} (${partner.name}, ${view.campaign.name})`,
      changes: { status: { from: watch.status, to: 'RESERVED' } },
    })

    await tellTheTeam({
      title: `${view.recipient.name} chose stock ${watch.stockNo}`,
      body: `${partner.name} · ${view.campaign.name}. It is on hold — nothing is paid.`,
      entityId: watch.id,
    })
  })
}

/** The owner, in the application and on their phone, as trade enquiries are. */
async function tellTheTeam(notice: { title: string; body: string; entityId: string }): Promise<void> {
  const people = await db
    .select({ id: users.id, phone: users.phone })
    .from(users)
    .where(and(eq(users.role, 'OWNER'), eq(users.isActive, true), isNull(users.deletedAt)))

  for (const person of people) {
    await db.insert(notifications).values({
      id: newId('ntf'),
      userId: person.id,
      type: 'PARTNER_ORDER',
      title: notice.title,
      body: notice.body,
      entityType: 'Watch',
      entityId: notice.entityId,
    })
  }
  for (const person of people) {
    if (!person.phone) continue
    const result = await sendWhatsApp(person.phone, `${notice.title}\n${notice.body}`)
    if (!result.sent) logger.info('campaign claim not relayed', { note: result.note })
  }
}

/** A campaign's name, for the held-stock list. Null where there was none. */
export async function campaignNamesFor(orderIds: string[]): Promise<Map<string, string>> {
  if (orderIds.length === 0) return new Map()
  const rows = await db
    .select({ orderId: partnerOrders.id, name: partnerCampaigns.name })
    .from(partnerOrders)
    .innerJoin(partnerCampaigns, eq(partnerCampaigns.id, partnerOrders.campaignId))
    .where(inArray(partnerOrders.id, orderIds))
  return new Map(rows.map((row) => [row.orderId, row.name]))
}

/**
 * A photograph of something this invitation actually offers.
 *
 * The id alone is not enough. The link goes out by email to a few dozen
 * people, and a route that served any image to anybody holding one would be a
 * way to read the whole photo library — warranty cards included — from a
 * forwarded message.
 *
 * Answered from the same list the page was drawn from, so the two can never
 * disagree: if a watch is not offered, its picture is not served.
 */
export async function getRecipientImage(token: string, imageId: string) {
  if (!token || token.length < 16 || !imageId) return null

  const view = await getRecipientView(token)
  if (!view) return null
  if (!view.choices.some((choice) => choice.imageIds.includes(imageId))) return null

  const [row] = await db
    .select({ data: watchImages.data, mime: watchImages.mimeType, size: watchImages.byteSize })
    .from(watchImages)
    .where(and(eq(watchImages.id, imageId), sql`${watchImages.kind} = 'WATCH'`))
    .limit(1)

  if (!row) return null
  return { data: row.data, mimeType: row.mime, byteSize: row.size }
}

/** Which watches a shortlist currently holds, for the screen that edits it. */
export async function shortlistIds(campaignId: string): Promise<string[]> {
  const rows = await db.select({ watchId: partnerCampaignItems.watchId })
    .from(partnerCampaignItems)
    .where(eq(partnerCampaignItems.campaignId, campaignId))
    .orderBy(asc(partnerCampaignItems.sortOrder))
  return rows.map((row) => row.watchId)
}
