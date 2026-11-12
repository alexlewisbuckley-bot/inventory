import Anthropic from '@anthropic-ai/sdk'
import { anthropicConfigured, anthropicKey, describeKeyProblem } from './ai-key-service'
import { IMAGE_KINDS, type ImageKind } from '@/lib/enums'
import { logger } from '@/lib/logger'
import { recordUsage, spendingAllowed } from './ai-usage'

/**
 * Reading a watch off its own photographs.
 *
 * A piece arrives, somebody photographs it next to its warranty card, and
 * everything needed to open a stock record is already in those two images:
 * the reference and the serial are printed on the card, and the dial, the
 * bracelet and the metal are in plain sight. Typing them in again from the
 * screen is transcription, and a serial transcribed by hand is the one field
 * nobody can check later — it is how the watch is identified to an insurer
 * and to the stolen-watch register.
 *
 * So this reads them, and stops there. The cost, the supplier and where the
 * watch is going are commercial facts no photograph contains, and they stay
 * where they were: typed by the person booking it in.
 *
 * Optional by construction, like the invoice reader it is modelled on. With
 * no API key this returns nothing and the form opens blank — an unconfigured
 * key should mean a form you fill in yourself, not a broken page.
 *
 * Two things keep it honest, and they are different in kind. The prompt ASKS
 * for an empty string where the photographs do not show something. The
 * caller REQUIRES it: the brand is resolved against the shop's own list
 * afterwards and dropped if it is not there, and every field lands in a form
 * field somebody is looking at before anything is written. A reading is a
 * head start, not a decision.
 */

/**
 * Under Vercel's 60s ceiling for a function, with room for the route.
 *
 * A timeout is not a failure here: the form is already on screen and still
 * works. It loses the head start, and says so.
 */
const TIMEOUT_MS = 50_000

const MODEL = 'claude-opus-5-5'

/**
 * Higher than the invoice reader's `low`.
 *
 * An invoice is laid out to be read; a serial is sixteen small characters
 * engraved between lugs or printed in a nine-point sans on a card, where 0/O
 * and 5/S are one glance apart. The reference and the serial are the whole
 * point of this feature and a wrong one is worse than a blank, so this is
 * the place to spend the thinking.
 */
const EFFORT = 'medium' as const

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** How many images one reading will look at. */
export const MAX_IMAGES = 6

export async function watchAiConfigured(): Promise<boolean> {
  return anthropicConfigured()
}

/** An identity-linked key must name its workspace; a workspace key needs none. */
function workspaceHeaders(): Record<string, string> | undefined {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim()
  return workspace ? { 'anthropic-workspace-id': workspace } : undefined
}

/**
 * Absent text is an empty string, not null.
 *
 * Copied from the invoice reader, where declaring every field
 * `["string", "null"]` pushed the schema past the strict-mode ceiling on
 * union-typed parameters and 400'd every request — a failure that looked
 * exactly like the model being unavailable. Text says "" for "the
 * photographs do not show it" and `coerceReading` turns that back into null.
 */
const absentAsEmpty = (description: string) => ({
  type: 'string',
  description: `${description} Empty string if the photographs do not show it.`,
})

/**
 * Numbers stay nullable, and are the only union-typed parameters here.
 *
 * There are two, against a ceiling of sixteen, and a test holds them there.
 */
const nullableNumber = (description: string) => ({ type: ['number', 'null'], description })

/**
 * The shape the answer must take.
 *
 * `strict` makes the API enforce it, which is the difference between parsing
 * a reply and receiving a record. Every property is required and has an
 * explicit way of saying "not shown", so a gap is something the model can
 * return rather than a reason to guess.
 */
export const WATCH_TOOL: Anthropic.Beta.BetaTool = {
  name: 'record_watch',
  description:
    'Record what these photographs of a single second-hand watch actually show. '
    + 'Leave text empty and numbers null for anything they do not show — never infer a value '
    + 'from what the model usually is, and never read a character you cannot see.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      // The two that matter. Everything below is a bonus.
      model: absentAsEmpty(
        'The manufacturer reference number, exactly as printed — e.g. "116610LN", "5711/1A-010". '
        + 'Usually on the warranty card beside the serial, sometimes between the lugs. '
        + 'This is NOT the model name and NOT the serial.',
      ),
      serial: absentAsEmpty(
        'The serial number unique to this individual watch, exactly as printed, preserving case. '
        + 'Do not guess an obscured or half-legible character — leave the whole field empty instead, '
        + 'because a serial that is nearly right is worse than one that is missing.',
      ),
      brand: absentAsEmpty('Maker as printed, e.g. "Rolex", "Patek Philippe", "Omega".'),
      modelName: absentAsEmpty('Model name without the maker, e.g. "Submariner Date", "Nautilus".'),
      year: nullableNumber(
        'Four-digit year of the watch, only where the photographs state it — a date of sale '
        + 'or guarantee date on the card. Null if it is only implied by the reference.',
      ),
      // Visual, and the kind of thing a photograph is actually good for.
      dial: absentAsEmpty('Dial colour and finish as seen, e.g. "Black", "Blue sunburst".'),
      caseMaterial: absentAsEmpty('Case metal as seen, e.g. "Steel", "18ct yellow gold", "Two-tone".'),
      bracelet: absentAsEmpty('Bracelet or strap as seen, e.g. "Oyster", "Jubilee", "Black leather".'),
      caseSizeMm: nullableNumber('Case diameter in mm, only where the photographs state it in writing.'),
      /*
       * What it could not read, in a sentence.
       *
       * The difference between "this card has no serial on it" and "the
       * serial is behind a reflection" decides whether somebody takes
       * another photograph, and only the reader knows which it was.
       */
      unreadable: absentAsEmpty('What you could not make out and why, in one short sentence.'),
      /*
       * One entry per image, in the order they were given.
       *
       * So the photographs file themselves: the picture of the watch becomes
       * the watch's picture and the picture of the card is filed as the card,
       * which is what the gallery already sorts by.
       */
      imageKinds: {
        type: 'array',
        description:
          'Exactly one entry per image supplied, in the same order: WATCH for a picture of the '
          + 'watch itself, CARD for a warranty or guarantee card, DOCUMENT for any other paperwork.',
        items: { type: 'string', enum: [...IMAGE_KINDS] },
      },
    },
    required: [
      'model', 'serial', 'brand', 'modelName', 'year',
      'dial', 'caseMaterial', 'bracelet', 'caseSizeMm', 'unreadable', 'imageKinds',
    ],
  },
}

const SYSTEM = `You are reading photographs taken while booking a second-hand luxury watch into a dealer's stock book. Usually one picture of the watch and one of its warranty card. Either on its own is enough to be getting on with: a card alone still carries the reference, the serial and the date, which is most of a stock record, and the watch is often not to hand when the paperwork arrives.

Record only what the photographs show.

- The reference and the serial are the point of this. They are different numbers and are usually printed together on the card: the reference identifies the model, the serial identifies this one watch. Do not put one in the other's field.
- Transcribe them character by character, preserving case. Do not correct, reformat, or complete them. If a character is obscured, reflected, or cut off, leave the whole field empty and say so in "unreadable" — a serial that is nearly right will be checked against a register and quietly fail.
- Do not infer from knowledge of the model. If the card does not state the year, the year is null even when the reference tells you the decade. If the dial is not visible, it is empty. A plausible invention is worse than a gap, because a gap is visible and an invention is not.
- Describe the dial, metal and bracelet from what is in the picture, in the plainest words a dealer would use. If there is no picture of the watch itself, leave all of them empty and say nothing about them in "unreadable" — a card with no watch is a normal way for stock to arrive, not a problem with the photographs.
- If the photographs show more than one watch, record the one that appears in most of them and say so in "unreadable".`

/** Everything the photographs gave up, before any of it is resolved or shown. */
export interface WatchReading {
  brand: string | null
  model: string | null
  serial: string | null
  modelName: string | null
  year: number | null
  dial: string | null
  caseMaterial: string | null
  bracelet: string | null
  caseSizeMm: number | null
  unreadable: string | null
  /** One per image sent, in order. */
  imageKinds: ImageKind[]
}

export interface WatchAiResult {
  reading: WatchReading | null
  error: string | null
}

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const wholeNumber = (value: unknown, min: number, max: number): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const rounded = Math.round(value)
  return rounded >= min && rounded <= max ? rounded : null
}

/**
 * The tool's arguments, turned into a reading.
 *
 * Exported and pure so the shape can be tested without a request: `strict`
 * makes the API enforce the schema, but it cannot enforce that a year is a
 * year, and this is the only place that decides what an answer means.
 */
export function coerceReading(input: unknown, imageCount: number): WatchReading | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>

  const kinds = Array.isArray(raw.imageKinds) ? raw.imageKinds : []
  return {
    brand: text(raw.brand),
    model: text(raw.model),
    serial: text(raw.serial),
    modelName: text(raw.modelName),
    // Wristwatches, not antiquities, and nothing from the future: a year
    // outside this is a misread date rather than a find.
    year: wholeNumber(raw.year, 1900, new Date().getFullYear() + 1),
    dial: text(raw.dial),
    caseMaterial: text(raw.caseMaterial),
    bracelet: text(raw.bracelet),
    caseSizeMm: wholeNumber(raw.caseSizeMm, 10, 80),
    unreadable: text(raw.unreadable),
    // One per image whatever came back, so the caller can file them by
    // position without checking the length first. A short answer, or an
    // entry that is not one of ours, leaves that image an ordinary picture.
    imageKinds: Array.from({ length: imageCount }, (_, index) => {
      const kind = kinds[index]
      return (IMAGE_KINDS as readonly string[]).includes(kind as string)
        ? (kind as ImageKind)
        : 'WATCH'
    }),
  }
}

export async function readWatchPhotos(
  images: { mimeType: string; buffer: ArrayBuffer }[],
): Promise<WatchAiResult> {
  if (!await watchAiConfigured()) return { reading: null, error: null }

  const usable = images.filter((image) => IMAGE_TYPES.has(image.mimeType)).slice(0, MAX_IMAGES)
  if (usable.length === 0) return { reading: null, error: 'none of those files could be read as images' }

  // Before the images are encoded, let alone sent: a ceiling that is checked
  // after the money is spent is a report, not a ceiling.
  const budget = await spendingAllowed()
  if (!budget.allowed) return { reading: null, error: budget.reason }

  const content: Anthropic.Beta.BetaContentBlockParam[] = []
  usable.forEach((image, index) => {
    // Numbered out loud, because "one entry per image in the same order" is
    // an instruction the model has to be able to follow, and it cannot count
    // blocks it has not been told the order of.
    content.push({ type: 'text', text: `Image ${index + 1} of ${usable.length}:` })
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mimeType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
        data: Buffer.from(image.buffer).toString('base64'),
      },
    })
  })
  content.push({ type: 'text', text: 'Record this watch by calling record_watch.' })

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
      // A refusal would leave the form with nothing to show for the upload;
      // the server-side fallback re-runs the same request on another model
      // inside the same call rather than coming back empty-handed.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      tools: [WATCH_TOOL],
      messages: [{ role: 'user', content }],
    })

    const call = response.content.find((block) => block.type === 'tool_use')
    if (!call || call.name !== 'record_watch') {
      logger.warn('watch photo reading returned no tool call', { stopReason: response.stop_reason })
      const reason = response.stop_reason === 'refusal'
        ? 'the request was declined'
        : `no reading came back (stopped: ${response.stop_reason})`
      await recordUsage({
        feature: 'watch-photo',
        model: MODEL,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        ok: false,
        error: reason,
      })
      return { reading: null, error: reason }
    }

    const reading = coerceReading(call.input, usable.length)
    await recordUsage({
      feature: 'watch-photo',
      model: MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      ok: true,
    })
    logger.info('watch read from photographs', {
      images: usable.length,
      gotReference: Boolean(reading?.model),
      gotSerial: Boolean(reading?.serial),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    })
    return { reading, error: null }
  } catch (error) {
    // Survivable, every one of them: the form is already on screen and the
    // person can type. Logged rather than raised, with the reason carried
    // out — a lapsed key and a timeout need different fixes and looked
    // identical from the other side of the screen.
    const reason = await describeFailure(error)
    logger.warn('watch photo reading failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    // No tokens, because nothing was read — but the row matters most here:
    // a run of these is what a lapsed key looks like from the outside.
    await recordUsage({ feature: 'watch-photo', model: MODEL, ok: false, error: reason })
    return { reading: null, error: reason }
  }
}

export async function describeFailure(error: unknown): Promise<string> {
  if (error instanceof Anthropic.AuthenticationError) {
    return `the API key was rejected: ${await describeKeyProblem()}`
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return 'the API key is not permitted to use this model'
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'the API rate limit or credit balance was hit'
  }
  if (error instanceof Anthropic.BadRequestError) {
    if (/anthropic-workspace-id/i.test(error.message)) {
      return 'this API key is linked to a person rather than a workspace, so it must name one — '
        + 'set ANTHROPIC_WORKSPACE_ID on the deployment, or issue a workspace-scoped key instead'
    }
    return `the request was rejected: ${error.message.slice(0, 200)}`
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return `it did not answer within ${TIMEOUT_MS / 1000}s`
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'the connection to the API failed'
  }
  return error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)
}
