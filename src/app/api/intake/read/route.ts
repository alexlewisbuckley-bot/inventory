import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { requireCapability } from '@/server/auth/session'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { db } from '@/server/db/client'
import { brands } from '@/server/db/schema'
import { slugify } from '@/lib/ids'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { MAX_IMAGES, readWatchPhotos, watchAiConfigured, type WatchReading } from '@/server/services/watch-ai'

export const dynamic = 'force-dynamic'

/** Reading photographs takes longer than a page render. Vercel's ceiling is 60s. */
export const maxDuration = 60

/**
 * What the form gets back.
 *
 * The brand arrives as the word printed on the dial and leaves as one of the
 * shop's own brands, or as nothing. Both halves are returned: `brandId` is
 * what the form can select, and `brandName` is what was read — so a maker
 * the book has never held can still be offered to the person as something to
 * add, rather than silently dropped on the way.
 */
export interface IntakeReading extends WatchReading {
  brandId: string | null
}

export interface IntakeReadResponse {
  reading: IntakeReading | null
  /** Why there is no reading, in a sentence somebody can act on. */
  error: string | null
  /** False when no key is configured: not a failure, just nothing on offer. */
  configured: boolean
}

/**
 * Read a watch from the photographs taken while booking it in.
 *
 * A route handler rather than a server action, for the reason the image
 * upload is one: server actions serialise their payload as JSON, which
 * base64s the bytes and inflates them by a third — and these are photographs
 * that have already been through a downscale to earn their size.
 *
 * Nothing is written. This reads files and returns what they say; the stock
 * record is created later, by the form, when somebody has looked at it.
 */
export async function POST(request: NextRequest) {
  try {
    // The capability for what this is in service of. It writes nothing, but
    // it spends money on the shop's behalf and is only useful to somebody
    // who is about to add stock.
    const actor = await requireCapability('watch:create')
    rateLimit({ key: `read:${actor.id}`, ...LIMITS.read })

    if (!watchAiConfigured()) {
      return NextResponse.json<IntakeReadResponse>({ reading: null, error: null, configured: false })
    }

    const form = await request.formData()
    const files = form.getAll('files').filter((entry): entry is File => entry instanceof File)
    if (files.length === 0) {
      return NextResponse.json({ error: 'No photographs received.' }, { status: 400 })
    }

    const images = await Promise.all(
      files.slice(0, MAX_IMAGES).map(async (file) => ({
        mimeType: file.type,
        buffer: await file.arrayBuffer(),
      })),
    )

    const { reading, error } = await readWatchPhotos(images)
    if (!reading) {
      return NextResponse.json<IntakeReadResponse>({ reading: null, error, configured: true })
    }

    return NextResponse.json<IntakeReadResponse>({
      reading: { ...reading, brandId: await resolveBrand(reading.brand) },
      error: null,
      configured: true,
    })
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error('watch photo reading route failed', { error: (error as Error).message })
    return NextResponse.json({ error: 'Could not read those photographs.' }, { status: 500 })
  }
}

/**
 * The word on the dial, matched to a brand the shop already keeps.
 *
 * Matched, never created. The importer makes the same distinction and says
 * why: looking at a file should not create a brand as a side effect. A maker
 * that is new to the book is a decision for the person booking it in, who
 * gets the name back and a button that adds it — one click, and deliberate.
 */
async function resolveBrand(name: string | null): Promise<string | null> {
  if (!name) return null
  const slug = slugify(name)
  if (!slug) return null
  const [found] = await db.select({ id: brands.id }).from(brands).where(eq(brands.slug, slug)).limit(1)
  return found?.id ?? null
}
