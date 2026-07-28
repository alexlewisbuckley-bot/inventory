import { and, asc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { watchImages, watches } from '../db/schema'
import { recordAudit } from './audit'
import { newId } from '@/lib/ids'
import { NotFoundError, ValidationError } from '@/lib/errors'
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

export async function getImageBytes(id: string) {
  const rows = await db
    .select({ data: watchImages.data, mimeType: watchImages.mimeType, byteSize: watchImages.byteSize })
    .from(watchImages)
    .where(eq(watchImages.id, id))
    .limit(1)
  return rows[0] ?? null
}

export async function addImage(
  input: { watchId: string; kind: ImageKind; mimeType: string; data: Buffer; width?: number; height?: number; caption?: string | null },
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

  const watch = await db.select({ id: watches.id, stockNo: watches.stockNo })
    .from(watches).where(eq(watches.id, input.watchId)).limit(1)
  if (!watch[0]) throw new NotFoundError('Watch')

  const existing = await db.select({ id: watchImages.id }).from(watchImages)
    .where(and(eq(watchImages.watchId, input.watchId), eq(watchImages.kind, input.kind)))

  const id = newId('img')
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
    sortOrder: existing.length,
    createdById: actor.id,
  })

  await recordAudit({
    entityType: 'Watch', entityId: input.watchId, action: 'UPDATE', actorId: actor.id,
    summary: `Image added to stock ${watch[0].stockNo}`,
  })

  return {
    id, kind: input.kind, mimeType: input.mimeType, byteSize: input.data.byteLength,
    width: input.width ?? null, height: input.height ?? null,
    caption: input.caption ?? null, sortOrder: existing.length, createdAt: new Date(),
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
