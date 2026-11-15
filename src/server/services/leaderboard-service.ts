import { randomBytes } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import {
  partnerLeaderboardAgents, partnerLeaderboardEntries, partnerLeaderboardPrizes,
  partnerLeaderboards, partners,
} from '../db/schema'
import { newId } from '@/lib/ids'
import { NotFoundError, ValidationError } from '@/lib/errors'
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
    .select({ id: partnerLeaderboards.id })
    .from(partnerLeaderboards)
    .where(and(eq(partnerLeaderboards.id, leaderboardId), eq(partnerLeaderboards.partnerId, partnerId)))
    .limit(1)
  if (!row) throw new NotFoundError('That challenge')
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
  partnerName: string
  hasLogo: boolean
  brandColor: string
  accentColor: string
  agents: Array<{ id: string; name: string; subtitle: string | null; hasPhoto: boolean; photoVersion: number | null }>
  prizes: Array<{
    id: string; name: string; kind: PrizeKind; valueBase: number | null
    rule: PrizeRule; rank: number | null; targetBase: number | null
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
    }).from(partnerLeaderboardPrizes)
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

  return { ...board, agents, prizes, entries }
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
  await owned(partnerId, leaderboardId)
  await db.update(partnerLeaderboards)
    .set({ isPublished: published, updatedAt: new Date() })
    .where(eq(partnerLeaderboards.id, leaderboardId))
}

export async function deleteLeaderboard(partnerId: string, leaderboardId: string) {
  await owned(partnerId, leaderboardId)
  await db.delete(partnerLeaderboards).where(eq(partnerLeaderboards.id, leaderboardId))
}

export async function addAgent(
  partnerId: string,
  leaderboardId: string,
  input: { name: string; subtitle: string | null; photo: { data: Buffer; mimeType: string } | null },
) {
  await owned(partnerId, leaderboardId)
  const name = input.name.trim()
  if (!name) throw new ValidationError('Give the agent a name.')
  if (input.photo) assertPhotoAcceptable(input.photo.mimeType, input.photo.data.byteLength)
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${partnerLeaderboardAgents.sortOrder}), 0) + 1` })
    .from(partnerLeaderboardAgents)
    .where(eq(partnerLeaderboardAgents.leaderboardId, leaderboardId))
  await db.insert(partnerLeaderboardAgents).values({
    id: newId(),
    leaderboardId,
    name: name.slice(0, 120),
    subtitle: input.subtitle?.trim().slice(0, 120) || null,
    photoMime: input.photo?.mimeType ?? null,
    photoData: input.photo?.data ?? null,
    photoByteSize: input.photo?.data.byteLength ?? null,
    sortOrder: next,
  })
  await touch(leaderboardId)
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
  await db.insert(partnerLeaderboardPrizes).values({ id: newId(), leaderboardId, ...prizeRow(input) })
  await touch(leaderboardId)
}

export async function updatePrize(partnerId: string, leaderboardId: string, prizeId: string, input: PrizeInput) {
  await owned(partnerId, leaderboardId)
  await db.update(partnerLeaderboardPrizes).set(prizeRow(input))
    .where(and(eq(partnerLeaderboardPrizes.id, prizeId), eq(partnerLeaderboardPrizes.leaderboardId, leaderboardId)))
  await touch(leaderboardId)
}

export async function removePrize(partnerId: string, leaderboardId: string, prizeId: string) {
  await owned(partnerId, leaderboardId)
  await db.delete(partnerLeaderboardPrizes)
    .where(and(eq(partnerLeaderboardPrizes.id, prizeId), eq(partnerLeaderboardPrizes.leaderboardId, leaderboardId)))
  await touch(leaderboardId)
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
  await owned(partnerId, leaderboardId)
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
