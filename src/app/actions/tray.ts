'use server'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { requireCapability } from '@/server/auth/session'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { db } from '@/server/db/client'
import { watches } from '@/server/db/schema'
import { commitImport, type ImportRow } from '@/server/services/import-service'
import { DEFAULT_PRODUCT_TYPE } from '@/lib/enums'
import { parseMoneyInput, toMajor } from '@/lib/money'
import { logger } from '@/lib/logger'
import { revalidatePath } from 'next/cache'
import { isAppError } from '@/lib/errors'
import type { ActionState } from './auth'

/**
 * Booking in a tray of watches read from one photograph.
 *
 * The reading is a head start and this is where it becomes stock — through
 * the same commit the spreadsheet import uses, so brands and suppliers are
 * created the same way, stock numbers are allocated the same way, movements
 * are written the same way, and photographs already held against a
 * reference dress the new rows the same way. A second implementation of any
 * of that is a second thing to keep right.
 */

export interface TrayLine {
  /** The manufacturer reference. The one field a row cannot do without. */
  model: string
  serial: string
  brand: string
  modelName: string
  /** Four digits, where the card gave a date it could be read from. */
  year: string
  dial: string
  caseMaterial: string
  bracelet: string
  /** What this one cost, in the batch's currency. Blank is allowed. */
  cost: string
}

export interface TrayBooking {
  lines: TrayLine[]
  /** Said once for the delivery, because that is how a delivery arrives. */
  supplier: string
  location: string
  owner: string
  /** When the SHOP bought these, not the date printed on the card. */
  purchaseDate: string
}

/**
 * Book the reviewed tray in.
 *
 * Everything is checked again here. The screen has already refused the
 * obvious gaps, but a server action is reachable without the screen and the
 * cost of trusting it is stock records nobody can account for.
 */
export async function bookInTrayAction(booking: TrayBooking): Promise<ActionState> {
  const actor = await requireCapability('data:import')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  const lines = booking.lines.filter((line) => line.model.trim() !== '')
  if (lines.length === 0) {
    return { ok: false, message: 'None of those rows has a reference, so there is nothing to book in.' }
  }
  if (!booking.supplier.trim()) return { ok: false, message: 'Choose who these came from.' }
  if (!booking.location.trim()) return { ok: false, message: 'Choose where they are.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(booking.purchaseDate)) {
    return { ok: false, message: 'Give the date the shop bought these.' }
  }

  /*
   * A delivery photographed twice is the realistic mistake here, and it
   * leaves two of everything with no obvious sign. Serials are the only
   * thing in a tray that identifies one watch, so they are what is checked.
   */
  const serials = lines.map((line) => line.serial.trim()).filter(Boolean)
  if (serials.length > 0) {
    const already = await db.select({ serial: watches.serial })
      .from(watches)
      .where(and(inArray(watches.serial, serials), isNull(watches.deletedAt)))
    if (already.length > 0) {
      const names = already.map((row) => row.serial).join(', ')
      return {
        ok: false,
        message: `Already in stock: ${names}. This tray looks like it has been booked in once already — `
          + 'remove those rows if you mean to book in the rest.',
      }
    }
  }

  const rows: ImportRow[] = lines.map((line, index) => ({
    line: index + 1,
    watchId: null,
    stockNo: null,
    renumberFrom: null,
    action: 'CREATE',
    changes: [],
    productType: DEFAULT_PRODUCT_TYPE,
    brand: line.brand.trim() || 'Unknown',
    model: line.model.trim(),
    serial: line.serial.trim() || null,
    supplier: booking.supplier.trim(),
    location: booking.location.trim(),
    owner: booking.owner.trim() || null,
    // The shop's purchase date, not the card's. The card says when the first
    // owner bought it from a retailer, which for a second-hand watch is a
    // different fact and belongs to the watch's year rather than to ours.
    purchaseDate: booking.purchaseDate,
    purchasePriceGbp: majorOrNull(line.cost),
    estSaleGbp: null,
    tradePriceGbp: null,
    spec: {
      modelName: line.modelName.trim() || null,
      year: yearOrNull(line.year),
      caseSizeMm: null,
      caseMaterial: line.caseMaterial.trim() || null,
      dial: line.dial.trim() || null,
      bracelet: line.bracelet.trim() || null,
      movement: null,
      waterResistanceM: null,
      condition: null,
      boxPapers: null,
      description: null,
    },
  }))

  try {
    const result = await commitImport(rows, actor)
    revalidatePath('/inventory')
    revalidatePath('/')
    logger.info('tray booked in', { created: result.created, by: actor.id })
    return {
      ok: true,
      message: `${result.created} ${result.created === 1 ? 'watch' : 'watches'} booked into stock`
        + `${result.photographs > 0 ? `, ${result.photographs} dressed from the library` : ''}.`,
    }
  } catch (error) {
    // Same shape the other actions use: an application error carries its own
    // message, anything else is logged and reported plainly.
    if (isAppError(error)) return { ok: false, message: error.message }
    logger.error('tray booking failed', { error: (error as Error).message })
    return { ok: false, message: 'Those watches could not be booked in.' }
  }
}

/** Blank is a real answer: a watch whose cost is not to hand yet. */
function majorOrNull(raw: string): number | null {
  const minor = parseMoneyInput(raw)
  return minor === null ? null : toMajor(minor)
}

function yearOrNull(raw: string): number | null {
  const year = Number(raw.trim())
  if (!Number.isInteger(year)) return null
  return year >= 1900 && year <= new Date().getFullYear() + 1 ? year : null
}
