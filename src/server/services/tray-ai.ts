import Anthropic from '@anthropic-ai/sdk'
import { logger } from '@/lib/logger'
import { watchAiConfigured, describeFailure } from './watch-ai'
import { anthropicKey } from './ai-key-service'
import { recordUsage, spendingAllowed } from './ai-usage'
import { CURRENCIES } from '@/lib/enums'

/**
 * A tray of watches, read in one go.
 *
 * Alex, with a photograph of four Rolexes laid out on bubble wrap, each
 * beside its own guarantee card: "I would like to be able to drop an image
 * like this somewhere and the system import them accordingly."
 *
 * This is how a delivery actually arrives — not one watch at a time, but a
 * bagged tray photographed on a desk before anything is unpacked. Every
 * reference and every serial is already in that one picture.
 *
 * Separate from the single-watch reader rather than a flag on it, because
 * the two are asking different questions. That one is told "these pictures
 * are of one watch" and uses several angles of it to fill in one record;
 * this one is told "there are several watches here" and its hardest job is
 * not reading the characters but pairing each card with the watch it
 * belongs to. A tool that returned one watch could not express getting the
 * pairing wrong, and a tool that returns many could not use three angles of
 * one watch.
 *
 * Three kinds of picture, not one. Alex: "Cant add image of spreadsheet
 * sometimes it should still work even if no photos of watches and scan the
 * detail and create a list the same." He is right that it is the same job.
 * A delivery arrives as a tray on a desk, or as a pile of cards with the
 * watches still in a safe somewhere, or as a dealer's stock sheet in a
 * screenshot — and in all three the question is "what are these, one row
 * each". Reading only the first was the reader deciding how a delivery is
 * allowed to turn up.
 */

const TIMEOUT_MS = 50_000
const MODEL = 'claude-opus-5-5'

/**
 * Higher than the single reader's.
 *
 * Pairing is a spatial judgement across a whole frame, and it is the thing
 * that goes wrong in a way nobody catches: a serial transposed between two
 * watches of the same model produces two records that are each individually
 * plausible and both wrong.
 */
const EFFORT = 'high' as const

/** The codes a row may be priced in: the shop's own list, nothing invented. */
const CURRENCY_CODES = CURRENCIES

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** A tray photograph is one image. Several is a tray and its close-ups. */
export const MAX_TRAY_IMAGES = 4

/**
 * The most rows one picture may produce.
 *
 * Twenty-four was right for a tray — no real delivery is photographed thirty
 * at a time, so a longer list was a misread. A screenshot of a stock sheet
 * is a different animal: forty rows on one screen is an ordinary Tuesday,
 * and cutting it at twenty-four would silently drop the bottom of somebody's
 * spreadsheet, which is worse than reading nothing at all.
 */
const MAX_WATCHES = 50

const absentAsEmpty = (description: string) => ({
  type: 'string',
  description: `${description} Empty string if the photograph does not show it.`,
})

/**
 * The shape the answer must take.
 *
 * One entry per watch, and the entry carries where in the frame it was.
 * That is not decoration: it is what lets somebody check the pairing at a
 * glance against the photograph they just took, which is the one error this
 * feature can make that is worth more than the time it saves.
 */
export const TRAY_TOOL: Anthropic.Beta.BetaTool = {
  name: 'record_watches',
  description:
    'Record every watch these photographs account for, one entry each — whether they are laid out '
    + 'with their guarantee cards, shown as cards alone, or listed as rows on a stock sheet, '
    + 'spreadsheet or offer list. Never invent a value and never read a character you cannot see.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      watches: {
        type: 'array',
        description: 'One entry per distinct watch, read left to right and top to bottom.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            position: absentAsEmpty(
              'Where this watch is in the frame, in plain words — "top left", "bottom right", '
              + '"second from the left". This is how somebody checks the pairing, so it must be accurate.',
            ),
            /*
             * Where to cut this watch out of the picture.
             *
             * Position in words was all there was, and on a tray of seven it
             * reads as a paragraph per row and still has to be held in the
             * head against the photograph. A crop of the watch itself puts
             * the answer on the row, where the pairing can be seen rather
             * than worked out.
             *
             * Percentages, not pixels, so the box survives the downscale
             * between what was read and what the browser holds. Plain
             * numbers rather than nullable ones: a strict schema counts
             * union-typed parameters against a ceiling, and a zero-sized
             * box already says "I could not place it".
             */
            box: {
              type: 'object',
              additionalProperties: false,
              description:
                'The rectangle around this entry as percentages of the whole image: the watch AND its '
                + 'card, or the card alone, or — on a list — the one row this entry was read from. '
                + 'All four zero if you cannot place it.',
              properties: {
                x: { type: 'number', description: 'Left edge, 0-100, as a percentage of image width.' },
                y: { type: 'number', description: 'Top edge, 0-100, as a percentage of image height.' },
                w: { type: 'number', description: 'Width, 0-100, as a percentage of image width.' },
                h: { type: 'number', description: 'Height, 0-100, as a percentage of image height.' },
              },
              required: ['x', 'y', 'w', 'h'],
            },
            model: absentAsEmpty(
              'The manufacturer reference for THIS watch, exactly as printed — e.g. "126500LN". '
              + 'From the card lying with it, or from the reference column of the list. '
              + 'Cards print it after MODEL. Not the model name, not the serial.',
            ),
            serial: absentAsEmpty(
              'The serial for THIS watch, exactly as printed, preserving case — from the card lying '
              + 'with it or from the serial column of the list. Cards print it after SERIAL. '
              + 'Leave empty rather than guess an obscured character.',
            ),
            brand: absentAsEmpty('Maker, e.g. "Rolex".'),
            modelName: absentAsEmpty(
              'Model name without the maker — "Daytona", "GMT-Master II", "Yacht-Master". Read from '
              + 'the watch itself, or from the description column of a list. Empty if you cannot tell.',
            ),
            cardDate: absentAsEmpty(
              'The date printed or handwritten on the card after DATE OF PURCHASE, exactly as written, '
              + 'e.g. "05.09.2025" or "04/03/2021". Do not reformat it and do not work out which part is '
              + 'the month — that is decided elsewhere.',
            ),
            dial: absentAsEmpty('Dial colour and finish as seen, e.g. "White", "Black", "Meteorite".'),
            caseMaterial: absentAsEmpty('Case metal as seen, e.g. "Steel", "Steel and gold", "Rose gold".'),
            bracelet: absentAsEmpty('Bracelet or strap as seen, e.g. "Oyster", "Jubilee", "Oysterflex".'),
            /*
             * What a list has that a tray never does.
             *
             * A stock sheet states the year and the price in their own
             * columns; a photograph of watches on a desk states neither.
             * Reading them is most of why somebody photographs a sheet at
             * all — without the price every row still has to be typed, and
             * then the picture saved nothing worth having.
             */
            year: absentAsEmpty(
              'The year of manufacture if the list states one in a column of its own, as four digits. '
              + 'Not the date on a guarantee card — that goes in cardDate. Empty on a tray photograph.',
            ),
            price: absentAsEmpty(
              'The amount shown against THIS row on a list — digits and separators only, no symbol, '
              + 'e.g. "28500" or "28,500.00". Where a row shows more than one amount, take the cost '
              + 'or buy price rather than a retail or asking price. Empty if the list shows no amount.',
            ),
            currency: absentAsEmpty(
              'The currency that amount is in, as a three-letter code — AED, USD, GBP, HKD '
              + '— worked out from the symbol beside it or the column heading above it. '
              + 'Empty if the list does not say, and never guessed from the country of the seller.',
            ),
            unreadable: absentAsEmpty(
              'What you could not make out on THIS watch and why, in a few words. Empty if all of it was clear.',
            ),
          },
          required: [
            'position', 'box', 'model', 'serial', 'brand', 'modelName',
            'cardDate', 'dial', 'caseMaterial', 'bracelet', 'year', 'price', 'currency', 'unreadable',
          ],
        },
      },
      /*
       * What kind of picture this was.
       *
       * The review screen says different things about a tray and a stock
       * sheet — "check each one against its picture" is advice for one and
       * nonsense for the other — and it cannot tell them apart from the rows
       * alone.
       */
      source: {
        type: 'string',
        enum: ['tray', 'cards', 'list', 'unclear'],
        description:
          'What these photographs are: "tray" for watches laid out, "cards" for guarantee cards with '
          + 'no watches, "list" for rows on a spreadsheet, stock sheet, offer list or invoice, '
          + '"unclear" if it is none of those or a mixture.',
      },
      /** Said once for the photograph rather than per watch. */
      note: absentAsEmpty(
        'Anything about the picture as a whole worth saying: a card with no watch, a watch with no '
        + 'card, two watches you could not tell apart, part of the tray or the list cut off, '
        + 'a column you could not read.',
      ),
    },
    required: ['watches', 'source', 'note'],
  },
}

const SYSTEM = `You are reading a picture taken while a delivery of second-hand luxury watches is being booked into a dealer's stock book. It will be one of three things, and all three are worth reading:

- WATCHES LAID OUT, often bagged, each with its own guarantee card beside or beneath it.
- CARDS ALONE, where the watches are not to hand. Still worth reading: the reference, the serial and the date are all on the card.
- A LIST — a spreadsheet, a stock sheet, a dealer's offer list, an invoice or a packing note, photographed or screenshotted. One row per watch, with the columns labelled at the top.

Record one entry per watch: per watch laid out, per card with no watch, or per row of the list. Decide which of the three you are looking at and say so in "source".

READING WATCHES AND CARDS
- Where watches and cards are both in the frame, pair each watch with the card lying WITH it, not the nearest card on the page. This is the thing that matters most here. A serial recorded against the wrong watch produces two records that each look right and are both wrong, and nobody finds out until the watch is sold. Work watch by watch: find the card touching or overlapping it, and read that card.
- The dial, metal and bracelet come from looking at the watch. The model name may come from the dial. Leave anything you cannot see empty — do not infer it from what the reference usually is. For a card with no watch, every one of these is empty, and that is a complete and correct entry rather than a failed one: the reference and serial are what make the record, and the rest is filled in later when the watch is in hand.
- A watch whose card is not in frame cannot give a serial, so it goes in "note" rather than becoming an entry nobody can identify.

READING A LIST
- Read the column headings first and work out what each column holds. Then take each row in turn, top to bottom, including rows whose cells are only partly filled.
- A row is a complete and correct entry even when most of its columns are empty. A list that gives nothing but "Rolex 126610LV" is one good row, not a failed reading.
- Take the values as the list states them. Do not convert a price, do not reformat a date, do not expand an abbreviation in the reference, and do not fill a blank cell from what the model usually is.
- Skip anything that is not a watch: heading rows, subtotals, totals, blank separators, and notes written underneath the table.
- If a row is struck through, marked sold, or marked reserved, read it anyway and say so in that row's "unreadable" field, so the person can decide.

IN ALL THREE
- Give each entry's position in the frame in plain words, accurately — "top left", "third row", "row 12" — so a person can check your reading against the picture.
- Give the rectangle around each entry as percentages of the whole image, so it can be cut out and shown beside what you read from it. Around the watch and its card together where there is a watch; around the card alone, or the single row of the list, where there is not. All four numbers zero if you cannot place it.
- The reference and the serial are transcribed character by character with case preserved. Do not correct, reformat or complete them. If a character is obscured, reflected or cut off, leave that whole field empty and say so in that entry's "unreadable".
- Copy any date exactly as written. Do not decide which number is the month.
- Count carefully, and do not stop early on a long list.`

/** One watch as the photograph gave it up. */
export interface TrayBox {
  x: number
  y: number
  w: number
  h: number
}

export interface TrayWatch {
  position: string | null
  /** Null where it could not be placed, which is a crop nobody can show. */
  box: TrayBox | null
  model: string | null
  serial: string | null
  brand: string | null
  modelName: string | null
  cardDate: string | null
  dial: string | null
  caseMaterial: string | null
  bracelet: string | null
  /** Four digits where a list stated the year in a column of its own. */
  year: string | null
  /** What the list said this cost, as printed. Null from a tray photograph. */
  price: string | null
  /** The currency of that amount, where the list made it plain. */
  currency: string | null
  unreadable: string | null
}

/** Which of the three kinds of picture this was. */
export type TraySource = 'tray' | 'cards' | 'list' | 'unclear'

export interface TrayReading {
  watches: TrayWatch[]
  source: TraySource
  note: string | null
}

export interface TrayAiResult {
  reading: TrayReading | null
  error: string | null
}

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * A rectangle worth cutting a picture on.
 *
 * Null for anything that would not produce a recognisable crop: all zeroes,
 * which is how the model says it could not place the watch; a sliver, which
 * is a misread rather than a watch; and anything running past the edge of
 * the image, which would crop to something nobody can identify. The row
 * then falls back to the position in words, which is what it had before.
 */
function coerceBox(value: unknown): TrayBox | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const n = (key: string) => (typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? raw[key] : NaN)
  const [x, y, w, h] = [n('x'), n('y'), n('w'), n('h')]
  if ([x, y, w, h].some(Number.isNaN)) return null
  // Two per cent of an edge is smaller than any watch on a tray photographed
  // whole, so anything under it is noise rather than a find.
  if (w < 2 || h < 2) return null
  if (x < 0 || y < 0 || x + w > 100.5 || y + h > 100.5) return null
  return { x, y, w, h }
}

/** A four-digit year, or nothing. A list's year column is free text like any other. */
function coerceYear(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const match = raw.match(/\b(19|20)\d{2}\b/)
  return match ? match[0] : null
}

/**
 * A currency a row may actually be priced in.
 *
 * Checked against the shop's own list rather than taken as given: a code
 * nothing downstream can convert would put a number on a row and silently
 * price it wrong, which is the exact fault this screen was rebuilt to stop.
 */
function coerceCurrency(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const code = raw.toUpperCase().replace(/[^A-Z]/g, '')
  return (CURRENCY_CODES as readonly string[]).includes(code) ? code : null
}

/**
 * The tool's arguments, turned into a reading.
 *
 * Pure and exported so the shape can be tested without a request.
 *
 * An entry is kept if it names a watch at all — by reference, by serial, or
 * by model name. The rule used to be reference-or-serial, which is right for
 * a tray, where anything else is a card nobody could read or a reflection
 * counted as a watch. On a list it threw away the reading: plenty of stock
 * sheets have a description column and no reference column, so every row
 * failed the test and the screen said no watches could be made out. A row
 * reading "Rolex Submariner Date" is a row somebody can finish in four
 * keystrokes, and far better than being told the picture was unreadable.
 */
export function coerceTray(input: unknown): TrayReading | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const list = Array.isArray(raw.watches) ? raw.watches : []

  const watches = list
    .slice(0, MAX_WATCHES)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      position: text(entry.position),
      box: coerceBox(entry.box),
      model: text(entry.model),
      serial: text(entry.serial),
      brand: text(entry.brand),
      modelName: text(entry.modelName),
      cardDate: text(entry.cardDate),
      dial: text(entry.dial),
      caseMaterial: text(entry.caseMaterial),
      bracelet: text(entry.bracelet),
      year: coerceYear(entry.year),
      price: text(entry.price),
      currency: coerceCurrency(entry.currency),
      unreadable: text(entry.unreadable),
    }))
    .filter((watch) => watch.model || watch.serial || watch.modelName)

  const source = text(raw.source)?.toLowerCase()
  return {
    watches,
    source: source === 'tray' || source === 'cards' || source === 'list' ? source : 'unclear',
    note: text(raw.note),
  }
}

export async function readTray(
  images: { mimeType: string; buffer: ArrayBuffer }[],
): Promise<TrayAiResult> {
  if (!await watchAiConfigured()) return { reading: null, error: null }

  const usable = images.filter((image) => IMAGE_TYPES.has(image.mimeType)).slice(0, MAX_TRAY_IMAGES)
  if (usable.length === 0) return { reading: null, error: 'none of those files could be read as images' }

  const budget = await spendingAllowed()
  if (!budget.allowed) return { reading: null, error: budget.reason }

  const content: Anthropic.Beta.BetaContentBlockParam[] = []
  usable.forEach((image, index) => {
    if (usable.length > 1) content.push({ type: 'text', text: `Image ${index + 1} of ${usable.length}:` })
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mimeType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
        data: Buffer.from(image.buffer).toString('base64'),
      },
    })
  })
  content.push({
    type: 'text',
    text: 'Record every watch these pictures account for by calling record_watches — '
      + 'whether they are laid out, shown as cards, or listed as rows.',
  })

  const client = new Anthropic({
    apiKey: await anthropicKey(),
    timeout: TIMEOUT_MS,
    maxRetries: 1,
    defaultHeaders: workspaceHeaders(),
  })

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16_000,
      output_config: { effort: EFFORT },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      tools: [TRAY_TOOL],
      messages: [{ role: 'user', content }],
    })

    const call = response.content.find((block) => block.type === 'tool_use')
    if (!call || call.name !== 'record_watches') {
      const reason = response.stop_reason === 'refusal'
        ? 'the request was declined'
        : `no reading came back (stopped: ${response.stop_reason})`
      await recordUsage({
        feature: 'watch-photo', model: MODEL, ok: false, error: reason,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      })
      return { reading: null, error: reason }
    }

    const reading = coerceTray(call.input)
    await recordUsage({
      feature: 'watch-photo',
      model: MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      ok: true,
    })
    logger.info('tray read from photographs', {
      images: usable.length,
      watches: reading?.watches.length ?? 0,
    })
    return { reading, error: null }
  } catch (error) {
    const reason = await describeFailure(error)
    logger.warn('tray reading failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    await recordUsage({ feature: 'watch-photo', model: MODEL, ok: false, error: reason })
    return { reading: null, error: reason }
  }
}

/** An identity-linked key must name its workspace; a workspace key needs none. */
function workspaceHeaders(): Record<string, string> | undefined {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim()
  return workspace ? { 'anthropic-workspace-id': workspace } : undefined
}
