import Anthropic from '@anthropic-ai/sdk'
import { logger } from '@/lib/logger'
import { watchAiConfigured, describeFailure } from './watch-ai'
import { anthropicKey } from './ai-key-service'
import { recordUsage, spendingAllowed } from './ai-usage'

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

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** A tray photograph is one image. Several is a tray and its close-ups. */
export const MAX_TRAY_IMAGES = 4

/** No real delivery is photographed thirty at a time, and a runaway list is a misread. */
const MAX_WATCHES = 24

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
    'Record every watch laid out in these photographs, one entry each, pairing each watch with '
    + 'the guarantee card lying with it. Never invent a value and never read a character you cannot see.',
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
                'The rectangle around this watch AND its card, as percentages of the whole image. '
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
              'The manufacturer reference from the card lying with THIS watch, exactly as printed — '
              + 'e.g. "126500LN". Cards print it after MODEL. Not the model name, not the serial.',
            ),
            serial: absentAsEmpty(
              'The serial from the card lying with THIS watch, exactly as printed, preserving case. '
              + 'Cards print it after SERIAL. Leave empty rather than guess an obscured character.',
            ),
            brand: absentAsEmpty('Maker, e.g. "Rolex".'),
            modelName: absentAsEmpty(
              'Model name without the maker, read from the watch itself — "Daytona", "GMT-Master II", '
              + '"Yacht-Master". Empty if you cannot tell from the picture.',
            ),
            cardDate: absentAsEmpty(
              'The date printed or handwritten on the card after DATE OF PURCHASE, exactly as written, '
              + 'e.g. "05.09.2025" or "04/03/2021". Do not reformat it and do not work out which part is '
              + 'the month — that is decided elsewhere.',
            ),
            dial: absentAsEmpty('Dial colour and finish as seen, e.g. "White", "Black", "Meteorite".'),
            caseMaterial: absentAsEmpty('Case metal as seen, e.g. "Steel", "Steel and gold", "Rose gold".'),
            bracelet: absentAsEmpty('Bracelet or strap as seen, e.g. "Oyster", "Jubilee", "Oysterflex".'),
            unreadable: absentAsEmpty(
              'What you could not make out on THIS watch and why, in a few words. Empty if all of it was clear.',
            ),
          },
          required: [
            'position', 'box', 'model', 'serial', 'brand', 'modelName',
            'cardDate', 'dial', 'caseMaterial', 'bracelet', 'unreadable',
          ],
        },
      },
      /** Said once for the photograph rather than per watch. */
      note: absentAsEmpty(
        'Anything about the photograph as a whole worth saying: a card with no watch, a watch with no '
        + 'card, two watches you could not tell apart, part of the tray cut off.',
      ),
    },
    required: ['watches', 'note'],
  },
}

const SYSTEM = `You are reading a photograph taken while a delivery of second-hand luxury watches is being booked into a dealer's stock book. Usually the watches are laid out — often bagged — each with its own guarantee card beside or beneath it. Sometimes the watches are not to hand and the photograph is of the cards alone, which is still worth reading: the reference, the serial and the date are all on the card.

Record one entry per watch, and one entry per card that has no watch with it.

- Where watches and cards are both in the frame, pair each watch with the card lying WITH it, not the nearest card on the page. This is the thing that matters most here. A serial recorded against the wrong watch produces two records that each look right and are both wrong, and nobody finds out until the watch is sold. Work watch by watch: find the card touching or overlapping it, and read that card.
- Give each entry's position in the frame in plain words, accurately, so a person can check your pairing against the picture.
- Give the rectangle around each watch and its card as percentages of the whole image, so that entry can be cut out and shown beside what you read from it. Include the card: the pairing is what somebody is checking. Where there is no watch, put the rectangle around the card by itself. All four numbers zero if you cannot place it.
- The reference and the serial come from the card, transcribed character by character with case preserved. Do not correct, reformat or complete them. If a character is obscured, reflected or cut off, leave that whole field empty and say so in that watch's "unreadable".
- The dial, metal and bracelet come from looking at the watch. The model name may come from the dial. Leave anything you cannot see empty — do not infer it from what the reference usually is. For a card with no watch, every one of these is empty, and that is a complete and correct entry rather than a failed one: the reference and serial are what make the record, and the rest is filled in later when the watch is in hand.
- Copy the date of purchase exactly as written on the card. Do not decide which number is the month.
- Count carefully. A watch whose card is not in frame cannot give a serial, so it goes in "note" rather than becoming an entry nobody can identify.`

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
  unreadable: string | null
}

export interface TrayReading {
  watches: TrayWatch[]
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

/**
 * The tool's arguments, turned into a reading.
 *
 * Pure and exported so the shape can be tested without a request. A watch
 * with neither a reference nor a serial is dropped: it is a card nobody
 * could read or a reflection counted as a watch, and carrying it into a
 * review screen as an empty row is worse than not mentioning it.
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
      unreadable: text(entry.unreadable),
    }))
    .filter((watch) => watch.model || watch.serial)

  return { watches, note: text(raw.note) }
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
  content.push({ type: 'text', text: 'Record every watch laid out here by calling record_watches.' })

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
