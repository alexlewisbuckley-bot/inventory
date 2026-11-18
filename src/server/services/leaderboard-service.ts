import { randomBytes } from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import {
  brands, partnerAgents, partnerLeaderboardAgents, partnerLeaderboardEntries, partnerLeaderboardPrizes,
  partnerLeaderboards, partnerOrders, partners, watches,
} from '../db/schema'
import { recordAudit } from './audit'
import { holdForPartner } from './partner-portal-service'
import { launchProblems } from '@/lib/leaderboard'
import { newId } from '@/lib/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { weekStartOf } from '@/lib/leaderboard'
import type { PrizeKind, PrizeRule } from '@/lib/enums'

/**
 * Leaderboard challenges: a partner's agents, their weekly figures, and the
 * prizes they are competing for.
 *
 * Every function takes the partner id and checks the board belongs to it.
 * The portal and the staff page both come through here, and a board id in a
 * form is something anybody can change — so ownership is checked on every
 * read and every write, not trusted from the screen that sent it.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const PHOTO_MAX = 3 * 1024 * 1024

export interface LeaderboardInput {
  name: string
  intro: string | null
  metricLabel: string | null
  startsOn: string
  endsOn: string
}

function checkInput(input: LeaderboardInput): LeaderboardInput {
  const name = input.name.trim()
  if (!name) throw new ValidationError('Give the challenge a name.')
  if (!ISO_DAY.test(input.startsOn) || !ISO_DAY.test(input.endsOn)) {
    throw new ValidationError('Choose a start and an end date.')
  }
  if (input.endsOn < input.startsOn) throw new ValidationError('The end date is before the start date.')
  return {
    name: name.slice(0, 120),
    intro: input.intro?.trim().slice(0, 1000) || null,
    metricLabel: input.metricLabel?.trim().slice(0, 60) || null,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
  }
}

/**
 * A photograph somebody uploaded of a person.
 *
 * No SVG, unlike a logo: an SVG is a document that can carry script, and these
 * are served from our own origin on a public page.
 */
export function assertPhotoAcceptable(mimeType: string, byteSize: number): void {
  if (!PHOTO_TYPES.includes(mimeType)) throw new ValidationError('A photo must be a PNG, JPEG or WebP image.')
  if (byteSize > PHOTO_MAX) throw new ValidationError('That photo is larger than 3MB. Please use a smaller one.')
}

async function owned(partnerId: string, leaderboardId: string) {
  const [row] = await db
    .select({ id: partnerLeaderboards.id, name: partnerLeaderboards.name, launchedAt: partnerLeaderboards.launchedAt })
    .from(partnerLeaderboards)
    .where(and(eq(partnerLeaderboards.id, leaderboardId), eq(partnerLeaderboards.partnerId, partnerId)))
    .limit(1)
  if (!row) throw new NotFoundError('That challenge')
  return row
}

const touch = (leaderboardId: string) =>
  db.update(partnerLeaderboards).set({ updatedAt: new Date() }).where(eq(partnerLeaderboards.id, leaderboardId))

export async function listLeaderboards(partnerId: string) {
  return db
    .select({
      id: partnerLeaderboards.id,
      name: partnerLeaderboards.name,
      startsOn: partnerLeaderboards.startsOn,
      endsOn: partnerLeaderboards.endsOn,
      isPublished: partnerLeaderboards.isPublished,
      shareToken: partnerLeaderboards.shareToken,
      agentCount: sql<number>`(SELECT count(*)::int FROM partner_leaderboard_agents a WHERE a.leaderboard_id = partner_leaderboards.id)`,
      prizeCount: sql<number>`(SELECT count(*)::int FROM partner_leaderboard_prizes p WHERE p.leaderboard_id = partner_leaderboards.id)`,
    })
    .from(partnerLeaderboards)
    .where(eq(partnerLeaderboards.partnerId, partnerId))
    .orderBy(sql`${partnerLeaderboards.endsOn} DESC`)
}

export interface LeaderboardFull {
  id: string
  partnerId: string
  name: string
  intro: string | null
  metricLabel: string
  startsOn: string
  endsOn: string
  shareToken: string
  isPublished: boolean
  /** ISO timestamp once launched. */
  launchedAt: string | null
  partnerName: string
  hasLogo: boolean
  brandColor: string
  accentColor: string
  agents: Array<{ id: string; name: string; subtitle: string | null; hasPhoto: boolean; photoVersion: number | null; partnerAgentId: string | null }>
  prizes: Array<{
    id: string; name: string; kind: PrizeKind; valueBase: number | null
    rule: PrizeRule; rank: number | null; targetBase: number | null
    /** For a watch chosen from stock: the hold, and whether it still stands. */
    watchId: string | null; orderId: string | null; holdLive: boolean
    stockNo: number | null; imageId: string | null
  }>
  entries: Array<{ agentId: string; weekStart: string; commissionBase: number; deals: number }>
}

async function loadFull(where: ReturnType<typeof eq>): Promise<LeaderboardFull | null> {
  const [board] = await db
    .select({
      id: partnerLeaderboards.id,
      partnerId: partnerLeaderboards.partnerId,
      name: partnerLeaderboards.name,
      intro: partnerLeaderboards.intro,
      metricLabel: partnerLeaderboards.metricLabel,
      startsOn: partnerLeaderboards.startsOn,
      endsOn: partnerLeaderboards.endsOn,
      shareToken: partnerLeaderboards.shareToken,
      isPublished: partnerLeaderboards.isPublished,
      launchedAt: partnerLeaderboards.launchedAt,
      partnerName: sql<string>`coalesce(${partners.displayName}, ${partners.name})`,
      hasLogo: sql<boolean>`${partners.logoData} is not null`,
      brandColor: partners.brandColor,
      accentColor: partners.accentColor,
    })
    .from(partnerLeaderboards)
    .innerJoin(partners, eq(partners.id, partnerLeaderboards.partnerId))
    .where(where)
    .limit(1)
  if (!board) return null

  const [agents, prizes, entries] = await Promise.all([
    db.select({
      id: partnerLeaderboardAgents.id,
      name: partnerLeaderboardAgents.name,
      subtitle: partnerLeaderboardAgents.subtitle,
      hasPhoto: sql<boolean>`${partnerLeaderboardAgents.photoData} is not null`,
      // Changes whenever the photo does, so it can sit in a URL and bust a cache.
      photoVersion: partnerLeaderboardAgents.photoByteSize,
      partnerAgentId: partnerLeaderboardAgents.partnerAgentId,
    }).from(partnerLeaderboardAgents)
      .where(eq(partnerLeaderboardAgents.leaderboardId, board.id))
      .orderBy(asc(partnerLeaderboardAgents.sortOrder), asc(partnerLeaderboardAgents.createdAt)),
    db.select({
      id: partnerLeaderboardPrizes.id,
      name: partnerLeaderboardPrizes.name,
      kind: partnerLeaderboardPrizes.kind,
      valueBase: partnerLeaderboardPrizes.valueBase,
      rule: partnerLeaderboardPrizes.rule,
      rank: partnerLeaderboardPrizes.rank,
      targetBase: partnerLeaderboardPrizes.targetBase,
      watchId: partnerLeaderboardPrizes.watchId,
      orderId: partnerLeaderboardPrizes.orderId,
      // Held means the order says so AND the watch agrees, as everywhere else.
      holdLive: sql<boolean>`coalesce(${partnerOrders.status} = 'PLACED' and ${watches.status} = 'RESERVED', false)`,
      stockNo: watches.stockNo,
      imageId: sql<string | null>`(SELECT i.id FROM watch_images i WHERE i.watch_id = partner_leaderboard_prizes.watch_id AND i.kind = 'WATCH' ORDER BY i.sort_order, i.created_at LIMIT 1)`,
    }).from(partnerLeaderboardPrizes)
      .leftJoin(partnerOrders, eq(partnerOrders.id, partnerLeaderboardPrizes.orderId))
      .leftJoin(watches, eq(watches.id, partnerLeaderboardPrizes.watchId))
      .where(eq(partnerLeaderboardPrizes.leaderboardId, board.id))
      .orderBy(
        // Positions first, 1st to last, then targets from the lowest bar up.
        sql`CASE WHEN ${partnerLeaderboardPrizes.rule} = 'RANK' THEN 0 ELSE 1 END`,
        asc(partnerLeaderboardPrizes.rank),
        asc(partnerLeaderboardPrizes.targetBase),
        asc(partnerLeaderboardPrizes.createdAt),
      ),
    db.select({
      agentId: partnerLeaderboardEntries.agentId,
      weekStart: partnerLeaderboardEntries.weekStart,
      commissionBase: partnerLeaderboardEntries.commissionBase,
      deals: partnerLeaderboardEntries.deals,
    }).from(partnerLeaderboardEntries)
      .where(eq(partnerLeaderboardEntries.leaderboardId, board.id))
      .orderBy(asc(partnerLeaderboardEntries.weekStart)),
  ])

  return {
    ...board,
    launchedAt: board.launchedAt ? board.launchedAt.toISOString() : null,
    agents,
    prizes: prizes.map((p) => ({ ...p, holdLive: Boolean(p.holdLive) })),
    entries,
  }
}

export async function getLeaderboard(partnerId: string, leaderboardId: string): Promise<LeaderboardFull> {
  const board = await loadFull(eq(partnerLeaderboards.id, leaderboardId))
  if (!board || board.partnerId !== partnerId) throw new NotFoundError('That challenge')
  return board
}

/** The public board, by its share link, and only once somebody has published it. */
export async function getSharedLeaderboard(shareToken: string): Promise<LeaderboardFull | null> {
  if (!shareToken || shareToken.length < 16) return null
  const board = await loadFull(eq(partnerLeaderboards.shareToken, shareToken))
  return board?.isPublished ? board : null
}

export async function createLeaderboard(partnerId: string, raw: LeaderboardInput): Promise<string> {
  const input = checkInput(raw)
  const id = newId()
  await db.insert(partnerLeaderboards).values({
    id,
    partnerId,
    name: input.name,
    intro: input.intro,
    metricLabel: input.metricLabel ?? 'Commission earned',
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    shareToken: randomBytes(24).toString('base64url'),
  })
  return id
}

export async function updateLeaderboard(partnerId: string, leaderboardId: string, raw: LeaderboardInput) {
  await owned(partnerId, leaderboardId)
  const input = checkInput(raw)
  await db.update(partnerLeaderboards).set({
    name: input.name,
    intro: input.intro,
    metricLabel: input.metricLabel ?? 'Commission earned',
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    updatedAt: new Date(),
  }).where(eq(partnerLeaderboards.id, leaderboardId))
}

export async function setLeaderboardPublished(partnerId: string, leaderboardId: string, published: boolean) {
  const board = await owned(partnerId, leaderboardId)
  if (published && !board.launchedAt) {
    throw new ValidationError('Launch the challenge before sharing it — the prizes have to be settled first.')
  }
  await db.update(partnerLeaderboards)
    .set({ isPublished: published, updatedAt: new Date() })
    .where(eq(partnerLeaderboards.id, leaderboardId))
}

export async function deleteLeaderboard(partnerId: string, leaderboardId: string) {
  const board = await owned(partnerId, leaderboardId)
  await withTransaction(async () => {
    const held = await db.select({ orderId: partnerLeaderboardPrizes.orderId })
      .from(partnerLeaderboardPrizes)
      .where(eq(partnerLeaderboardPrizes.leaderboardId, leaderboardId))
    for (const { orderId } of held) {
      if (orderId) await releasePrizeHold(orderId, `Leaderboard "${board.name}" was deleted`)
    }
    await db.delete(partnerLeaderboards).where(eq(partnerLeaderboards.id, leaderboardId))
  })
}

/**
 * Let a prize watch go back on sale.
 *
 * The same two steps as releasing any partner hold: the order is closed, and
 * the watch returns to stock only if it is still where the hold left it — it
 * may have been sold through the ordinary flow in the meantime, and that sale
 * must not be undone by somebody tidying a leaderboard.
 */
async function releasePrizeHold(orderId: string, reason: string) {
  const [row] = await db
    .select({ status: partnerOrders.status, watchId: watches.id, watchStatus: watches.status, version: watches.version, stockNo: watches.stockNo })
    .from(partnerOrders)
    .innerJoin(watches, eq(watches.id, partnerOrders.watchId))
    .where(eq(partnerOrders.id, orderId))
    .limit(1)
  if (!row || row.status !== 'PLACED') return
  await db.update(partnerOrders)
    .set({ status: 'RELEASED', releasedAt: new Date(), releaseReason: reason, updatedAt: new Date() })
    .where(eq(partnerOrders.id, orderId))
  if (row.watchStatus === 'RESERVED') {
    await db.update(watches)
      .set({ status: 'IN_STOCK', updatedAt: new Date(), version: row.version + 1 })
      .where(eq(watches.id, row.watchId))
    await recordAudit({
      entityType: 'Watch', entityId: row.watchId, action: 'UPDATE', actorId: null,
      summary: `Stock ${row.stockNo} released from a leaderboard prize: ${reason}`,
      changes: { status: { from: 'RESERVED', to: 'IN_STOCK' } },
    })
  }
}

export async function addAgent(
  partnerId: string,
  leaderboardId: string,
  input: { name: string; subtitle: string | null; photo: { data: Buffer; mimeType: string } | null; saveToTeam?: boolean },
) {
  await owned(partnerId, leaderboardId)
  const name = input.name.trim()
  if (!name) throw new ValidationError('Give the agent a name.')
  if (input.photo) assertPhotoAcceptable(input.photo.mimeType, input.photo.data.byteLength)
  await withTransaction(async () => {
    const memberId = input.saveToTeam ? await addTeamMember(partnerId, input) : null
    await db.insert(partnerLeaderboardAgents).values({
      id: newId(),
      leaderboardId,
      name: name.slice(0, 120),
      subtitle: input.subtitle?.trim().slice(0, 120) || null,
      photoMime: input.photo?.mimeType ?? null,
      photoData: input.photo?.data ?? null,
      photoByteSize: input.photo?.data.byteLength ?? null,
      partnerAgentId: memberId,
      sortOrder: await nextAgentOrder(leaderboardId),
    })
    await touch(leaderboardId)
  })
}

async function nextAgentOrder(leaderboardId: string): Promise<number> {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${partnerLeaderboardAgents.sortOrder}), 0) + 1` })
    .from(partnerLeaderboardAgents)
    .where(eq(partnerLeaderboardAgents.leaderboardId, leaderboardId))
  return next
}

/* ------------------------------------------------------------------ team */

export interface TeamMember {
  id: string
  name: string
  subtitle: string | null
  hasPhoto: boolean
  photoVersion: number | null
}

/** A partner's team, in the order they were added. */
export async function listTeam(partnerId: string): Promise<TeamMember[]> {
  return db.select({
    id: partnerAgents.id,
    name: partnerAgents.name,
    subtitle: partnerAgents.subtitle,
    hasPhoto: sql<boolean>`${partnerAgents.photoData} is not null`,
    photoVersion: partnerAgents.photoByteSize,
  }).from(partnerAgents)
    .where(eq(partnerAgents.partnerId, partnerId))
    .orderBy(asc(partnerAgents.sortOrder), asc(partnerAgents.createdAt))
}

export async function addTeamMember(
  partnerId: string,
  input: { name: string; subtitle: string | null; photo: { data: Buffer; mimeType: string } | null },
): Promise<string> {
  const name = input.name.trim()
  if (!name) throw new ValidationError('Give the agent a name.')
  if (input.photo) assertPhotoAcceptable(input.photo.mimeType, input.photo.data.byteLength)
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${partnerAgents.sortOrder}), 0) + 1` })
    .from(partnerAgents).where(eq(partnerAgents.partnerId, partnerId))
  const id = newId()
  await db.insert(partnerAgents).values({
    id,
    partnerId,
    name: name.slice(0, 120),
    subtitle: input.subtitle?.trim().slice(0, 120) || null,
    photoMime: input.photo?.mimeType ?? null,
    photoData: input.photo?.data ?? null,
    photoByteSize: input.photo?.data.byteLength ?? null,
    sortOrder: next,
  })
  return id
}

/** Change a team member. Boards that already took them keep their copy. */
export async function updateTeamMember(
  partnerId: string,
  memberId: string,
  input: { name: string; subtitle: string | null; photo: { data: Buffer; mimeType: string } | null },
) {
  const name = input.name.trim()
  if (!name) throw new ValidationError('Give the agent a name.')
  if (input.photo) assertPhotoAcceptable(input.photo.mimeType, input.photo.data.byteLength)
  const updated = await db.update(partnerAgents).set({
    name: name.slice(0, 120),
    subtitle: input.subtitle?.trim().slice(0, 120) || null,
    ...(input.photo ? {
      photoMime: input.photo.mimeType, photoData: input.photo.data, photoByteSize: input.photo.data.byteLength,
    } : {}),
    updatedAt: new Date(),
  }).where(and(eq(partnerAgents.id, memberId), eq(partnerAgents.partnerId, partnerId)))
    .returning({ id: partnerAgents.id })
  if (updated.length === 0) throw new NotFoundError('That agent')
}

export async function removeTeamMember(partnerId: string, memberId: string) {
  await db.delete(partnerAgents).where(and(eq(partnerAgents.id, memberId), eq(partnerAgents.partnerId, partnerId)))
}

export async function getTeamPhoto(partnerId: string, memberId: string) {
  const [row] = await db
    .select({ data: partnerAgents.photoData, mime: partnerAgents.photoMime })
    .from(partnerAgents)
    .where(and(eq(partnerAgents.id, memberId), eq(partnerAgents.partnerId, partnerId)))
    .limit(1)
  if (!row?.data || !row.mime) return null
  return { data: row.data, mimeType: row.mime }
}

/**
 * Put team members on a board, as many as were ticked.
 *
 * Each becomes the board's own copy — name, title and photo as they stand
 * today — linked back so the picker knows who is already in. Anybody already
 * on the board is skipped rather than added twice.
 */
export async function addAgentsFromTeam(partnerId: string, leaderboardId: string, memberIds: string[]): Promise<number> {
  await owned(partnerId, leaderboardId)
  if (memberIds.length === 0) throw new ValidationError('Choose at least one agent.')
  return withTransaction(async () => {
    const members = await db.select().from(partnerAgents)
      .where(and(eq(partnerAgents.partnerId, partnerId), inArray(partnerAgents.id, memberIds)))
      .orderBy(asc(partnerAgents.sortOrder))
    const already = new Set((await db.select({ id: partnerLeaderboardAgents.partnerAgentId })
      .from(partnerLeaderboardAgents)
      .where(eq(partnerLeaderboardAgents.leaderboardId, leaderboardId))).map((r) => r.id))
    let order = await nextAgentOrder(leaderboardId)
    let added = 0
    for (const m of members) {
      if (already.has(m.id)) continue
      await db.insert(partnerLeaderboardAgents).values({
        id: newId(),
        leaderboardId,
        name: m.name,
        subtitle: m.subtitle,
        photoMime: m.photoMime,
        photoData: m.photoData,
        photoByteSize: m.photoByteSize,
        partnerAgentId: m.id,
        sortOrder: order++,
      })
      added++
    }
    await touch(leaderboardId)
    return added
  })
}

export async function setAgentPhoto(
  partnerId: string,
  leaderboardId: string,
  agentId: string,
  photo: { data: Buffer; mimeType: string } | null,
) {
  await owned(partnerId, leaderboardId)
  if (photo) assertPhotoAcceptable(photo.mimeType, photo.data.byteLength)
  await db.update(partnerLeaderboardAgents).set({
    photoMime: photo?.mimeType ?? null,
    photoData: photo?.data ?? null,
    photoByteSize: photo?.data.byteLength ?? null,
  }).where(and(eq(partnerLeaderboardAgents.id, agentId), eq(partnerLeaderboardAgents.leaderboardId, leaderboardId)))
  await touch(leaderboardId)
}

export async function updateAgent(
  partnerId: string,
  leaderboardId: string,
  agentId: string,
  input: { name: string; subtitle: string | null },
) {
  await owned(partnerId, leaderboardId)
  const name = input.name.trim()
  if (!name) throw new ValidationError('Give the agent a name.')
  await db.update(partnerLeaderboardAgents).set({
    name: name.slice(0, 120),
    subtitle: input.subtitle?.trim().slice(0, 120) || null,
  }).where(and(eq(partnerLeaderboardAgents.id, agentId), eq(partnerLeaderboardAgents.leaderboardId, leaderboardId)))
  await touch(leaderboardId)
}

export async function removeAgent(partnerId: string, leaderboardId: string, agentId: string) {
  await owned(partnerId, leaderboardId)
  await db.delete(partnerLeaderboardAgents)
    .where(and(eq(partnerLeaderboardAgents.id, agentId), eq(partnerLeaderboardAgents.leaderboardId, leaderboardId)))
  await touch(leaderboardId)
}

export interface PrizeInput {
  name: string
  kind: PrizeKind
  valueBase: number | null
  rule: PrizeRule
  rank: number | null
  targetBase: number | null
}

function prizeRow(input: PrizeInput) {
  const name = input.name.trim()
  if (!name) throw new ValidationError('Describe the prize, e.g. "Rolex Submariner" or "AED 10,000 voucher".')
  if (input.rule === 'RANK' && !(input.rank && input.rank >= 1)) {
    throw new ValidationError('Choose which finishing position wins this prize.')
  }
  if (input.rule === 'TARGET' && !(input.targetBase && input.targetBase > 0)) {
    throw new ValidationError('Set the target an agent has to reach to win this prize.')
  }
  return {
    name: name.slice(0, 160),
    kind: input.kind,
    valueBase: input.valueBase && input.valueBase > 0 ? input.valueBase : null,
    rule: input.rule,
    rank: input.rule === 'RANK' ? input.rank : null,
    targetBase: input.rule === 'TARGET' ? input.targetBase : null,
  }
}

export async function addPrize(partnerId: string, leaderboardId: string, input: PrizeInput) {
  await owned(partnerId, leaderboardId)
  if (input.kind === 'WATCH') {
    throw new ValidationError('Choose a watch prize from the stock list, so it can be reserved for you.')
  }
  await db.insert(partnerLeaderboardPrizes).values({ id: newId(), leaderboardId, ...prizeRow(input) })
  await touch(leaderboardId)
}

export async function updatePrize(partnerId: string, leaderboardId: string, prizeId: string, input: PrizeInput) {
  await owned(partnerId, leaderboardId)
  const [prize] = await db.select({ orderId: partnerLeaderboardPrizes.orderId, name: partnerLeaderboardPrizes.name, kind: partnerLeaderboardPrizes.kind, valueBase: partnerLeaderboardPrizes.valueBase })
    .from(partnerLeaderboardPrizes)
    .where(and(eq(partnerLeaderboardPrizes.id, prizeId), eq(partnerLeaderboardPrizes.leaderboardId, leaderboardId)))
    .limit(1)
  if (!prize) throw new NotFoundError('That prize')
  // A reserved watch stays the watch it is: only how it is won can change.
  // A different watch is a different hold — remove this one and choose again.
  const row = prize.orderId
    ? prizeRow({ ...input, name: prize.name, kind: 'WATCH', valueBase: prize.valueBase })
    : prizeRow(input.kind === 'WATCH' ? { ...input, kind: 'VOUCHER' } : input)
  await db.update(partnerLeaderboardPrizes).set(row)
    .where(and(eq(partnerLeaderboardPrizes.id, prizeId), eq(partnerLeaderboardPrizes.leaderboardId, leaderboardId)))
  await touch(leaderboardId)
}

/**
 * A watch from stock as a prize: reserved for the client there and then.
 *
 * Through the same hold as a portal reservation — checked against the row,
 * priced at the partner's rate, audited, and announced to our team — so it
 * sits on the held-stock list with everything else and nobody can sell it
 * while the agents are competing for it.
 */
export async function reservePrizeWatch(
  partnerId: string,
  leaderboardId: string,
  input: { watchId: string; rule: PrizeRule; rank: number | null; targetBase: number | null },
) {
  const board = await owned(partnerId, leaderboardId)
  const [partner] = await db
    .select({ id: partners.id, name: partners.name, discountBps: partners.discountBps })
    .from(partners).where(eq(partners.id, partnerId)).limit(1)
  if (!partner) throw new NotFoundError('That partner')
  // Validate how it is won before anything is held.
  prizeRow({ name: 'x', kind: 'WATCH', valueBase: null, ...input })

  const how = input.rule === 'RANK' ? `position ${input.rank}` : 'a target'
  await withTransaction(async () => {
    const orderId = await holdForPartner(partner, {
      watchId: input.watchId,
      placedByName: `Leaderboard: ${board.name}`,
      placedByEmail: null,
      note: `Prize for the leaderboard challenge "${board.name}" (won by ${how}). Held until the challenge ends.`,
    }, {
      title: `${partner.name} has reserved a leaderboard prize`,
      body: `Chosen as a prize for "${board.name}". Nothing is paid — it is on hold until the challenge ends or somebody releases it.`,
    })
    const [watch] = await db
      .select({ brandName: brands.name, model: watches.model, modelName: watches.modelName })
      .from(watches).innerJoin(brands, eq(brands.id, watches.brandId))
      .where(eq(watches.id, input.watchId)).limit(1)
    const [order] = await db.select({ price: partnerOrders.priceAtOrder })
      .from(partnerOrders).where(eq(partnerOrders.id, orderId)).limit(1)
    await db.insert(partnerLeaderboardPrizes).values({
      id: newId(),
      leaderboardId,
      ...prizeRow({
        name: [watch?.brandName, watch?.model, watch?.modelName].filter(Boolean).join(' ') || 'Watch',
        kind: 'WATCH',
        valueBase: order?.price ?? null,
        ...input,
      }),
      watchId: input.watchId,
      orderId,
    })
    await touch(leaderboardId)
  })
}

/** Settle the prizes and start the clock: figures and sharing open after this. */
export async function launchLeaderboard(partnerId: string, leaderboardId: string) {
  const board = await getLeaderboard(partnerId, leaderboardId)
  if (board.launchedAt) return
  const problems = launchProblems(board)
  if (problems.length) throw new ValidationError(problems[0]!)
  await db.update(partnerLeaderboards)
    .set({ launchedAt: new Date(), updatedAt: new Date() })
    .where(eq(partnerLeaderboards.id, leaderboardId))
}

export async function removePrize(partnerId: string, leaderboardId: string, prizeId: string) {
  const board = await owned(partnerId, leaderboardId)
  await withTransaction(async () => {
    const [prize] = await db.select({ orderId: partnerLeaderboardPrizes.orderId })
      .from(partnerLeaderboardPrizes)
      .where(and(eq(partnerLeaderboardPrizes.id, prizeId), eq(partnerLeaderboardPrizes.leaderboardId, leaderboardId)))
      .limit(1)
    if (!prize) return
    if (prize.orderId) await releasePrizeHold(prize.orderId, `Removed as a prize from "${board.name}"`)
    await db.delete(partnerLeaderboardPrizes).where(eq(partnerLeaderboardPrizes.id, prizeId))
    await touch(leaderboardId)
  })
}

/**
 * One week's figures for every agent, entered together.
 *
 * Replaces whatever that week held — entering a week twice is a correction,
 * not a second helping. A row left blank removes that agent's figure for the
 * week, so an entry made against the wrong person can be taken back.
 */
export async function saveWeek(
  partnerId: string,
  leaderboardId: string,
  week: string,
  rows: Array<{ agentId: string; commissionBase: number | null; deals: number | null }>,
) {
  const board = await owned(partnerId, leaderboardId)
  if (!board.launchedAt) throw new ConflictError('Launch the challenge before entering figures — its prizes have to be settled first.')
  if (!ISO_DAY.test(week)) throw new ValidationError('Choose the week these figures are for.')
  const weekStart = weekStartOf(week)
  const agentIds = new Set((await db
    .select({ id: partnerLeaderboardAgents.id })
    .from(partnerLeaderboardAgents)
    .where(eq(partnerLeaderboardAgents.leaderboardId, leaderboardId))).map((a) => a.id))

  for (const row of rows) {
    if (row.commissionBase !== null && (row.commissionBase < 0 || !Number.isFinite(row.commissionBase))) {
      throw new ValidationError('Figures cannot be negative.')
    }
    if (row.deals !== null && (row.deals < 0 || !Number.isInteger(row.deals))) {
      throw new ValidationError('Deals must be a whole number.')
    }
  }

  await withTransaction(async () => {
    for (const row of rows) {
      if (!agentIds.has(row.agentId)) continue
      const where = and(
        eq(partnerLeaderboardEntries.agentId, row.agentId),
        eq(partnerLeaderboardEntries.weekStart, weekStart),
      )
      if (row.commissionBase === null && row.deals === null) {
        await db.delete(partnerLeaderboardEntries).where(where)
        continue
      }
      await db.insert(partnerLeaderboardEntries).values({
        id: newId(),
        leaderboardId,
        agentId: row.agentId,
        weekStart,
        commissionBase: Math.round(row.commissionBase ?? 0),
        deals: row.deals ?? 0,
      }).onConflictDoUpdate({
        target: [partnerLeaderboardEntries.agentId, partnerLeaderboardEntries.weekStart],
        set: {
          commissionBase: Math.round(row.commissionBase ?? 0),
          deals: row.deals ?? 0,
          updatedAt: new Date(),
        },
      })
    }
    await db.update(partnerLeaderboards).set({ updatedAt: new Date() }).where(eq(partnerLeaderboards.id, leaderboardId))
  })
}

/**
 * An agent's photo, by the board's share token.
 *
 * The token is the key whether or not the board is published, because the
 * people managing an unpublished board still need to see faces on it. It is
 * long and random, and opens nothing but these photographs and the board.
 */
export async function getAgentPhoto(shareToken: string, agentId: string) {
  if (!shareToken || shareToken.length < 16 || !agentId) return null
  const [row] = await db
    .select({ data: partnerLeaderboardAgents.photoData, mime: partnerLeaderboardAgents.photoMime })
    .from(partnerLeaderboardAgents)
    .innerJoin(partnerLeaderboards, eq(partnerLeaderboards.id, partnerLeaderboardAgents.leaderboardId))
    .where(and(eq(partnerLeaderboards.shareToken, shareToken), eq(partnerLeaderboardAgents.id, agentId)))
    .limit(1)
  if (!row?.data || !row.mime) return null
  return { data: row.data, mimeType: row.mime }
}

/** The company's logo on its public board, without exposing its portal link. */
export async function getLeaderboardLogo(shareToken: string) {
  if (!shareToken || shareToken.length < 16) return null
  const [row] = await db
    .select({ data: partners.logoData, mime: partners.logoMime })
    .from(partnerLeaderboards)
    .innerJoin(partners, eq(partners.id, partnerLeaderboards.partnerId))
    .where(eq(partnerLeaderboards.shareToken, shareToken))
    .limit(1)
  if (!row?.data || !row.mime) return null
  return { data: row.data, mimeType: row.mime }
}

/**
 * A stock photograph for the prize picker and prize cards, by share token.
 *
 * Website photographs only, and only of a watch that is on offer or is
 * held as a prize on this very board — the same closed list as the portal's
 * own image route, so an id from somewhere else opens nothing.
 */
export async function getPrizeImage(shareToken: string, imageId: string) {
  if (!shareToken || shareToken.length < 16 || !imageId) return null
  const rows = await db.execute<{ data: Buffer; mime: string }>(sql`
    SELECT i.data, i.mime_type AS mime
    FROM watch_images i
    JOIN partner_leaderboards b ON b.share_token = ${shareToken}
    JOIN watches w ON w.id = i.watch_id
    WHERE i.id = ${imageId} AND i.kind = 'WATCH' AND w.deleted_at IS NULL
      AND (
        w.status = 'IN_STOCK'
        OR EXISTS (SELECT 1 FROM partner_leaderboard_prizes p WHERE p.leaderboard_id = b.id AND p.watch_id = w.id)
      )
    LIMIT 1`)
  const row = (rows as unknown as Array<{ data: Buffer; mime: string }>)[0]
  if (!row) return null
  return { data: row.data, mimeType: row.mime }
}
