import { createHash } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import { brands, referenceImages, watchImages, watches } from '../db/schema'
import { recordAudit } from './audit'
import { newId } from '@/lib/ids'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { SessionUser } from '../auth/session'
import type { ImageKind } from '@/lib/enums'

/** Formats browsers render natively and that compress well for photographs. */
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/**
 * Hard ceiling per image.
 *
 * The browser downscales before upload, so anything arriving above this is
 * either a very large original or a client that skipped the resize. 4 MB also
 * keeps requests inside the body limit serverless platforms impose.
 */
const MAX_BYTES = 4 * 1024 * 1024

export interface ImageSummary {
  id: string
  kind: ImageKind
  mimeType: string
  byteSize: number
  width: number | null
  height: number | null
  caption: string | null
  sortOrder: number
  createdAt: Date
  /** How many photographs this one stood in for. Nought unless replacing. */
  replaced?: number
}

/** Metadata only — the bytes are fetched separately so lists stay light. */
export async function listImages(watchId: string): Promise<ImageSummary[]> {
  const rows = await db
    .select({
      id: watchImages.id, kind: watchImages.kind, mimeType: watchImages.mimeType,
      byteSize: watchImages.byteSize, width: watchImages.width, height: watchImages.height,
      caption: watchImages.caption, sortOrder: watchImages.sortOrder, createdAt: watchImages.createdAt,
    })
    .from(watchImages)
    .where(eq(watchImages.watchId, watchId))
    .orderBy(asc(watchImages.kind), asc(watchImages.sortOrder), asc(watchImages.createdAt))
  return rows.map((row) => ({ ...row, kind: row.kind as ImageKind }))
}

/**
 * The bytes of one photograph, for a reader who is allowed some of them.
 *
 * `kinds` is the list the caller may see. It is a parameter rather than a
 * filter applied afterwards because the two readers of this are not equal: we
 * see everything a watch has, and a dealer signed in to the catalogue sees
 * the watch and the trade shot and no paperwork at all. Passing nothing means
 * every kind, which is what the inside of the building gets.
 */
export async function getImageBytes(id: string, kinds?: readonly ImageKind[]) {
  const rows = await db
    .select({ data: watchImages.data, mimeType: watchImages.mimeType, byteSize: watchImages.byteSize })
    .from(watchImages)
    .where(kinds
      ? and(eq(watchImages.id, id), inArray(watchImages.kind, [...kinds]))
      : eq(watchImages.id, id))
    .limit(1)
  return rows[0] ?? null
}

export async function addImage(
  input: {
    watchId: string; kind: ImageKind; mimeType: string; data: Buffer
    width?: number; height?: number; caption?: string | null
    /**
     * Stand in for the photographs this watch already has of this kind,
     * rather than joining them.
     *
     * Added photographs sort after the ones already there, and everything
     * that shows one watch — the table, the gallery, the shop — shows the
     * first. So adding to a watch that already has a photograph changes
     * nothing anybody can see, which is right when you are building up a
     * gallery and wrong when you have just taken a better picture. The
     * caller has to say which it is; it is never assumed, because the
     * other reading deletes somebody's photographs.
     */
    replace?: boolean
  },
  actor: SessionUser,
): Promise<ImageSummary> {
  if (!(ALLOWED_TYPES as readonly string[]).includes(input.mimeType)) {
    throw new ValidationError('Only JPEG, PNG and WebP images can be uploaded.')
  }
  if (input.data.byteLength === 0) {
    throw new ValidationError('That file appears to be empty.')
  }
  if (input.data.byteLength > MAX_BYTES) {
    throw new ValidationError(
      `Images must be under ${Math.round(MAX_BYTES / 1024 / 1024)} MB. This one is ${(input.data.byteLength / 1024 / 1024).toFixed(1)} MB.`,
    )
  }

  const watch = await db
    .select({ id: watches.id, stockNo: watches.stockNo, brandId: watches.brandId, reference: watches.model })
    .from(watches).where(eq(watches.id, input.watchId)).limit(1)
  if (!watch[0]) throw new NotFoundError('Watch')

  const existing = await db.select({ id: watchImages.id }).from(watchImages)
    .where(and(eq(watchImages.watchId, input.watchId), eq(watchImages.kind, input.kind)))

  const replacing = input.replace ? existing.length : 0
  const sortOrder = input.replace ? 0 : existing.length
  const id = newId('img')

  // One transaction: a removal that commits without its replacement would
  // leave the watch with no photograph at all.
  await withTransaction(async () => {
    if (replacing > 0) {
      await db.delete(watchImages)
        .where(and(eq(watchImages.watchId, input.watchId), eq(watchImages.kind, input.kind)))
    }
    await db.insert(watchImages).values({
      id,
      watchId: input.watchId,
      kind: input.kind,
      mimeType: input.mimeType,
      byteSize: input.data.byteLength,
      width: input.width ?? null,
      height: input.height ?? null,
      data: input.data,
      caption: input.caption ?? null,
      sortOrder,
      createdById: actor.id,
    })
  })

  // Bank it against the reference as well, so the next watch of this model
  // does not need the photograph taken again. Photographs of the watch only,
  // and never allowed to fail the upload that produced them.
  if (input.kind === 'WATCH') {
    await bankPhotograph({
      brandId: watch[0].brandId,
      reference: watch[0].reference,
      mimeType: input.mimeType,
      data: input.data,
      width: input.width ?? null,
      height: input.height ?? null,
    }, actor.id)
  }

  await recordAudit({
    entityType: 'Watch', entityId: input.watchId, action: 'UPDATE', actorId: actor.id,
    summary: replacing > 0
      ? `Image replaced on stock ${watch[0].stockNo} (${replacing} removed)`
      : `Image added to stock ${watch[0].stockNo}`,
  })

  return {
    id, kind: input.kind, mimeType: input.mimeType, byteSize: input.data.byteLength,
    width: input.width ?? null, height: input.height ?? null,
    caption: input.caption ?? null, sortOrder, createdAt: new Date(), replaced: replacing,
  }
}

export async function deleteImage(id: string, actor: SessionUser): Promise<void> {
  const rows = await db.select({ watchId: watchImages.watchId }).from(watchImages)
    .where(eq(watchImages.id, id)).limit(1)
  if (!rows[0]) throw new NotFoundError('Image')

  await db.delete(watchImages).where(eq(watchImages.id, id))
  await recordAudit({
    entityType: 'Watch', entityId: rows[0].watchId, action: 'UPDATE', actorId: actor.id,
    summary: 'Image removed',
  })
}

export { ALLOWED_TYPES, MAX_BYTES }

/* ------------------------------------------------------------------ *
 * The reference library.
 *
 * A photograph of a 179383 is a photograph of every 179383, and until this
 * existed one lived only on the watch it was uploaded to — so when that watch
 * sold its picture went with it, and the next one of the same model was
 * photographed again from scratch.
 * ------------------------------------------------------------------ */

/** One reference, one shelf: upper-cased with every separator removed. */
export function referenceKey(reference: string): string {
  return reference.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export interface LibraryImage {
  id: string
  label: string
  width: number | null
  height: number | null
  byteSize: number
  createdAt: Date
}

/**
 * Put a photograph on the shelf for its reference.
 *
 * Quiet and idempotent. The unique index on the bytes is what makes it so:
 * the same photograph uploaded to three watches of one reference is banked
 * once, and a library that listed it three times is a library nobody scrolls
 * to the end of.
 *
 * Never throws into the caller. Banking is a convenience for next month; an
 * upload that worked must not be reported as failed because the shelf did
 * not take it.
 */
export async function bankPhotograph(
  input: {
    brandId: string; reference: string; mimeType: string; data: Buffer
    width: number | null; height: number | null
  },
  actorId: string | null,
): Promise<void> {
  const key = referenceKey(input.reference)
  if (!key) return
  try {
    await db.insert(referenceImages).values({
      id: newId('ref'),
      brandId: input.brandId,
      reference: key,
      label: input.reference,
      mimeType: input.mimeType,
      byteSize: input.data.byteLength,
      width: input.width,
      height: input.height,
      data: input.data,
      digest: createHash('sha256').update(input.data).digest('hex'),
      createdById: actorId,
    }).onConflictDoNothing()
  } catch (error) {
    logger.warn('could not bank a reference photograph', { error: (error as Error).message })
  }
}

/** Everything on the shelf for one reference, newest first. */
export async function listLibrary(brandId: string, reference: string): Promise<LibraryImage[]> {
  const key = referenceKey(reference)
  if (!key) return []
  return db
    .select({
      id: referenceImages.id,
      label: referenceImages.label,
      width: referenceImages.width,
      height: referenceImages.height,
      byteSize: referenceImages.byteSize,
      createdAt: referenceImages.createdAt,
    })
    .from(referenceImages)
    .where(and(eq(referenceImages.brandId, brandId), eq(referenceImages.reference, key)))
    .orderBy(desc(referenceImages.createdAt))
}

/** How many watches of each reference the shelf can already dress. */
export async function libraryCounts(): Promise<Map<string, number>> {
  const rows = await db
    .select({ brandId: referenceImages.brandId, reference: referenceImages.reference, n: sql<number>`count(*)::int` })
    .from(referenceImages)
    .groupBy(referenceImages.brandId, referenceImages.reference)
  return new Map(rows.map((r) => [`${r.brandId}:${r.reference}`, r.n]))
}

export async function getLibraryBytes(id: string) {
  const rows = await db
    .select({ data: referenceImages.data, mimeType: referenceImages.mimeType, byteSize: referenceImages.byteSize })
    .from(referenceImages)
    .where(eq(referenceImages.id, id))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Take a copy of a banked photograph for one watch.
 *
 * A copy, not a share. The watch owns its own row exactly as it would for an
 * upload, so one watch selling and being cleaned up cannot pull a picture out
 * from under another listing — and nothing in the gallery says where it came
 * from, because to this watch it is simply its photograph.
 *
 * The shelf is only ever read here, so a watch may only take an image banked
 * under its own brand and reference.
 */
export async function useLibraryImage(
  input: { watchId: string; referenceImageId: string },
  actor: SessionUser,
): Promise<ImageSummary> {
  const watch = await db
    .select({ id: watches.id, stockNo: watches.stockNo, brandId: watches.brandId, reference: watches.model })
    .from(watches).where(eq(watches.id, input.watchId)).limit(1)
  if (!watch[0]) throw new NotFoundError('Watch')

  const source = await db.select().from(referenceImages)
    .where(eq(referenceImages.id, input.referenceImageId)).limit(1)
  if (!source[0]) throw new NotFoundError('Photograph')

  // Same brand, same reference. Otherwise this is a photograph of a different
  // watch being put on this one, which is the whole thing the matcher refuses
  // to do by accident.
  if (source[0].brandId !== watch[0].brandId
    || source[0].reference !== referenceKey(watch[0].reference)) {
    throw new ValidationError('That photograph belongs to a different reference.')
  }

  const existing = await db.select({ id: watchImages.id }).from(watchImages)
    .where(and(eq(watchImages.watchId, input.watchId), eq(watchImages.kind, 'WATCH')))

  const id = newId('img')
  await db.insert(watchImages).values({
    id,
    watchId: input.watchId,
    kind: 'WATCH',
    mimeType: source[0].mimeType,
    byteSize: source[0].byteSize,
    width: source[0].width,
    height: source[0].height,
    data: source[0].data,
    caption: null,
    sortOrder: existing.length,
    createdById: actor.id,
  })

  await recordAudit({
    entityType: 'Watch', entityId: input.watchId, action: 'UPDATE', actorId: actor.id,
    summary: `Photograph added to stock ${watch[0].stockNo} from the ${source[0].label} library`,
  })

  return {
    id, kind: 'WATCH', mimeType: source[0].mimeType, byteSize: source[0].byteSize,
    width: source[0].width, height: source[0].height,
    caption: null, sortOrder: existing.length, createdAt: new Date(),
  }
}

/**
 * Dress a freshly created watch from the shelf, if there is anything on it.
 *
 * Used by the importer: twenty watches booked in from a sheet, fourteen of
 * them references photographed before, and those fourteen arrive with a
 * picture rather than a grey box. Returns how many were dressed.
 */
export async function dressFromLibrary(
  watchIds: Array<{ id: string; brandId: string; reference: string }>,
  actorId: string,
): Promise<number> {
  let dressed = 0
  for (const watch of watchIds) {
    const key = referenceKey(watch.reference)
    if (!key) continue
    const found = await db.select().from(referenceImages)
      .where(and(eq(referenceImages.brandId, watch.brandId), eq(referenceImages.reference, key)))
      .orderBy(desc(referenceImages.createdAt))
      .limit(1)
    if (!found[0]) continue
    await db.insert(watchImages).values({
      id: newId('img'),
      watchId: watch.id,
      kind: 'WATCH',
      mimeType: found[0].mimeType,
      byteSize: found[0].byteSize,
      width: found[0].width,
      height: found[0].height,
      data: found[0].data,
      caption: null,
      sortOrder: 0,
      createdById: actorId,
    })
    dressed += 1
  }
  return dressed
}

/**
 * Take a photograph off the shelf.
 *
 * Only the library copy. Watches that already took one hold their own row and
 * keep it — the whole reason this is a copy and not a share is that a watch's
 * gallery should not change because something happened somewhere else.
 */
export async function removeLibraryImage(id: string, actor: SessionUser): Promise<void> {
  const rows = await db.select({ label: referenceImages.label }).from(referenceImages)
    .where(eq(referenceImages.id, id)).limit(1)
  if (!rows[0]) throw new NotFoundError('Photograph')

  await db.delete(referenceImages).where(eq(referenceImages.id, id))
  await recordAudit({
    entityType: 'Watch', entityId: 'library', action: 'UPDATE', actorId: actor.id,
    summary: `Photograph removed from the ${rows[0].label} library`,
  })
}

/* ================= every photograph, under the serial ================= */

/** One watch and the photographs taken of it. */
export interface PhotographedWatch {
  id: string
  stockNo: number
  /** The serial, which is what the photographs are named after. */
  serial: string | null
  brandName: string
  model: string
  nickname: string | null
  status: string
  photographs: Array<{ id: string; kind: ImageKind; mimeType: string }>
}

/**
 * The photographs this house holds, filed under the serial of the watch in
 * them, which is a different question from the one the stock list answers.
 *
 * Photographs arrive off a phone as IMG_2841, IMG_2842, IMG_2843 — eighty of
 * them in a row, identical names, no way to tell from a filename which watch
 * is in the picture. Once they are uploaded that stops mattering here, because
 * the watch they belong to is what they are attached to. It starts mattering
 * again the moment one has to leave: sent to a dealer, filed on a drive,
 * attached to a message. A serial is the one name a photograph of a watch can
 * carry that means the same thing to everybody who sees it.
 *
 * Only photographs of the watch — the published shot and the trade one.
 * Warranty cards and receipts are the same watch's paperwork and belong to
 * the record rather than to this wall, and naming a scan of a receipt after a
 * serial would make it look like a photograph of the piece.
 *
 * Two queries rather than a join: a watch with eight photographs would
 * otherwise arrive as eight rows of itself, and the page counts watches.
 */
export async function photographedWatches(): Promise<PhotographedWatch[]> {
  const rows = await db
    .select({
      id: watches.id,
      stockNo: watches.stockNo,
      serial: watches.serial,
      brandName: brands.name,
      model: watches.model,
      nickname: watches.nickname,
      status: watches.status,
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .where(and(
      isNull(watches.deletedAt),
      sql`EXISTS (
        SELECT 1 FROM watch_images i
        WHERE i.watch_id = ${watches.id} AND i.kind IN ('WATCH', 'TRADE')
      )`,
    ))
    .orderBy(asc(watches.stockNo))

  if (rows.length === 0) return []

  const images = await db
    .select({
      watchId: watchImages.watchId,
      id: watchImages.id,
      kind: watchImages.kind,
      mimeType: watchImages.mimeType,
    })
    .from(watchImages)
    .where(and(
      inArray(watchImages.watchId, rows.map((row) => row.id)),
      inArray(watchImages.kind, ['WATCH', 'TRADE']),
    ))
    // The published shot first, then the order somebody arranged them in, so
    // the first photograph on the wall is the one the listing leads with.
    .orderBy(sql`${watchImages.kind} <> 'WATCH'`, asc(watchImages.sortOrder), asc(watchImages.createdAt))

  const byWatch = new Map<string, PhotographedWatch['photographs']>()
  for (const image of images) {
    const list = byWatch.get(image.watchId) ?? []
    list.push({ id: image.id, kind: image.kind as ImageKind, mimeType: image.mimeType })
    byWatch.set(image.watchId, list)
  }

  return rows.map((row) => ({ ...row, photographs: byWatch.get(row.id) ?? [] }))
}
