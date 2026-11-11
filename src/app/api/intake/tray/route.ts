import { NextResponse, type NextRequest } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
import { requireCapability } from '@/server/auth/session'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { db } from '@/server/db/client'
import { brands, referenceImages } from '@/server/db/schema'
import { slugify } from '@/lib/ids'
import { referenceKey } from '@/server/services/image-service'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { watchAiConfigured } from '@/server/services/watch-ai'
import { MAX_TRAY_IMAGES, readTray, type TrayWatch } from '@/server/services/tray-ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** A watch as read, with the maker resolved against the shop's own list. */
export interface TrayRow extends TrayWatch {
  /** Null where the maker is unknown to the book, which the screen says. */
  brandId: string | null
  /*
   * A photograph the library already holds for this reference.
   *
   * Alex: "It should also try and find a stock image from the library for
   * the reference number should they exist." The commit has always dressed
   * new stock from the library — this is the same lookup, run early, so the
   * screen can say which rows will arrive with a picture before anything is
   * booked in. It doubles as a check on the reading: a library photograph
   * of a Daytona against a row that says GMT-Master is a reference read
   * wrong, and that is visible at a glance.
   */
  libraryImageId: string | null
}

export interface TrayReadResponse {
  watches: TrayRow[]
  /** Anything about the photograph as a whole: a card with no watch, a cut-off tray. */
  note: string | null
  error: string | null
  configured: boolean
}

/**
 * Read a tray of watches from one photograph.
 *
 * Writes nothing. It reads the picture and answers; the stock records are
 * created afterwards, by a person who has looked at what it said, through
 * the same commit the spreadsheet import uses.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireCapability('watch:create')
    rateLimit({ key: `read:${actor.id}`, ...LIMITS.read })

    if (!await watchAiConfigured()) {
      return NextResponse.json<TrayReadResponse>({
        watches: [], note: null, error: null, configured: false,
      })
    }

    const form = await request.formData()
    const files = form.getAll('files').filter((entry): entry is File => entry instanceof File)
    if (files.length === 0) {
      return NextResponse.json({ error: 'No photographs received.' }, { status: 400 })
    }

    const images = await Promise.all(
      files.slice(0, MAX_TRAY_IMAGES).map(async (file) => ({
        mimeType: file.type,
        buffer: await file.arrayBuffer(),
      })),
    )

    const { reading, error } = await readTray(images)
    if (!reading) {
      return NextResponse.json<TrayReadResponse>({ watches: [], note: null, error, configured: true })
    }

    // Resolved once per distinct maker rather than once per watch: a tray is
    // usually one brand, and this is a query each.
    const makers = new Map<string, string | null>()
    for (const watch of reading.watches) {
      const slug = watch.brand ? slugify(watch.brand) : ''
      if (!slug || makers.has(slug)) continue
      const [found] = await db.select({ id: brands.id }).from(brands).where(eq(brands.slug, slug)).limit(1)
      makers.set(slug, found?.id ?? null)
    }

    const rows = await Promise.all(reading.watches.map(async (watch) => {
      const brandId = watch.brand ? makers.get(slugify(watch.brand)) ?? null : null
      return { ...watch, brandId, libraryImageId: await libraryPhoto(brandId, watch.model) }
    }))

    return NextResponse.json<TrayReadResponse>({
      watches: rows,
      note: reading.note,
      error: null,
      configured: true,
    })
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error('tray reading route failed', { error: (error as Error).message })
    return NextResponse.json({ error: 'Could not read that photograph.' }, { status: 500 })
  }
}

/**
 * The newest library photograph for a reference, if there is one.
 *
 * Matched on the same pair `dressFromLibrary` matches on — the brand and the
 * normalised reference — so what the screen promises and what the commit
 * actually does cannot come apart.
 */
async function libraryPhoto(brandId: string | null, reference: string | null): Promise<string | null> {
  if (!brandId || !reference) return null
  const key = referenceKey(reference)
  if (!key) return null
  const [found] = await db.select({ id: referenceImages.id })
    .from(referenceImages)
    .where(and(eq(referenceImages.brandId, brandId), eq(referenceImages.reference, key)))
    .orderBy(desc(referenceImages.createdAt))
    .limit(1)
  return found?.id ?? null
}
