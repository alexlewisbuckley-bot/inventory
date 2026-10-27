import Anthropic from '@anthropic-ai/sdk'
import { logger } from '@/lib/logger'
import { BASE_CURRENCY, type CurrencyCode } from '@/lib/enums'
import type { XeroInvoice } from '@/lib/xero-invoice'
import { coerceXeroInvoices, XERO_VISION_SCHEMA, VISION_CURRENCIES } from '@/lib/xero-vision-shape'

/**
 * Reading a screenshot of Xero.
 *
 * Alex: "I want to be able to drop screenshots of xero into the reconcile
 * feature."
 *
 * Which is a fair ask: getting an export out of Xero is four clicks and a
 * download, and taking a picture of the screen already open is none. The
 * matching layer was built so a second source could feed it without
 * anything downstream changing, and this is that second source — it
 * returns `XeroInvoice[]` and the matcher cannot tell where they came
 * from.
 *
 * Thin on purpose. Everything that can be got wrong about the model's
 * answer is in `xero-vision-shape.ts`, which is pure and tested; this file
 * only sends the pictures and hands back what came out.
 */

const MODEL = 'claude-opus-5'
/** A screen of invoices is a bigger read than a single document. */
const TIMEOUT_MS = 60_000
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** More than this in one go is a scroll somebody should export instead. */
export const MAX_SHOTS = 8

export function visionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

function workspaceHeaders(): Record<string, string> | undefined {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim()
  return workspace ? { 'anthropic-workspace-id': workspace } : undefined
}

export function isScreenshot(file: { name: string; type?: string }): boolean {
  if (file.type && IMAGE_TYPES.has(file.type)) return true
  return /\.(png|jpe?g|webp|gif)$/i.test(file.name)
}

const SYSTEM = `You are reading screenshots of Xero's Sales Invoices screens for a watch dealer in Dubai.

Report every invoice you can see by calling record_xero_invoices.

Rules that matter:
- Copy figures and text exactly as shown. Do not convert, round, tidy or translate.
- A total of "297,000.01" is reported as "297,000.01", not as 297000 and not as a number.
- Use "" for anything the screen does not show. Never guess a value, and never
  invent an invoice number, a date or an amount that is not visible.
- The currency is one of ${VISION_CURRENCIES}. If the screen shows a symbol rather
  than a code, give the code it means. If nothing indicates a currency, use "".
- The reference field often carries a stock number such as "Stock 1366". Copy it
  exactly; it is how the invoice gets matched to a watch.
- A list view shows one row per invoice and no line items. That is normal:
  report the invoices with an empty lines array rather than inventing lines.
- If two screenshots show the same invoice, report it once.
- If an invoice is cut off at the edge of a screenshot and you cannot read its
  number or its total, leave it out rather than reporting a partial figure.`

const TOOL: Anthropic.Beta.BetaToolUnion = {
  name: 'record_xero_invoices',
  description: 'Record every Xero invoice visible in the screenshots.',
  input_schema: XERO_VISION_SCHEMA as Anthropic.Beta.BetaTool['input_schema'],
}

export interface VisionReading {
  invoices: XeroInvoice[]
  /** Invoices the model reported that could not be used, and why they were not. */
  dropped: number
  error: string | null
}

export async function readXeroScreenshots(
  files: Array<{ name: string; mimeType: string; buffer: ArrayBuffer }>,
  base: CurrencyCode = BASE_CURRENCY,
): Promise<VisionReading> {
  if (!visionConfigured()) {
    return {
      invoices: [],
      dropped: 0,
      error: 'Reading screenshots needs ANTHROPIC_API_KEY set on the deployment. '
        + 'Until it is, export the Sales Invoices list from Xero as CSV or XLSX and drop that instead.',
    }
  }

  const shots = files.filter((file) => IMAGE_TYPES.has(file.mimeType)).slice(0, MAX_SHOTS)
  if (shots.length === 0) {
    return { invoices: [], dropped: 0, error: 'None of those files is an image.' }
  }

  const content: Anthropic.Beta.BetaContentBlockParam[] = shots.map((file) => ({
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: file.mimeType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
      data: Buffer.from(file.buffer).toString('base64'),
    },
  }))
  content.push({
    type: 'text',
    text: shots.length === 1
      ? 'Record every Xero invoice visible in this screenshot.'
      : `Record every Xero invoice visible across these ${shots.length} screenshots, each one once.`,
  })

  const client = new Anthropic({
    timeout: TIMEOUT_MS,
    maxRetries: 1,
    defaultHeaders: workspaceHeaders(),
  })

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16_000,
      // A reconciliation is checked line by line on the review screen
      // afterwards, but a misread total is a correction somebody might
      // approve without looking, so this is not the place to be quick.
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      tools: [TOOL],
      messages: [{ role: 'user', content }],
    })

    const call = response.content.find((block) => block.type === 'tool_use')
    if (!call || call.name !== 'record_xero_invoices') {
      logger.warn('xero screenshot read returned no tool call', { stopReason: response.stop_reason })
      return {
        invoices: [],
        dropped: 0,
        error: response.stop_reason === 'refusal'
          ? 'The request was declined.'
          : `Nothing came back from the reading (stopped: ${response.stop_reason}).`,
      }
    }

    const { invoices, dropped } = coerceXeroInvoices(call.input, base)
    logger.info('xero screenshots read', {
      shots: shots.length,
      invoices: invoices.length,
      dropped,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    })
    return { invoices, dropped, error: null }
  } catch (error) {
    logger.warn('xero screenshot read failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { invoices: [], dropped: 0, error: describeFailure(error) }
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'The API key was rejected — check ANTHROPIC_API_KEY on the deployment.'
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return 'The API key is not permitted to use this model.'
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'The API rate limit or credit balance was hit. Try again shortly.'
  }
  if (error instanceof Anthropic.BadRequestError) {
    if (/anthropic-workspace-id/i.test(error.message)) {
      return 'This API key is linked to a person rather than a workspace, so it must name one — '
        + 'set ANTHROPIC_WORKSPACE_ID on the deployment, or issue a workspace-scoped key instead.'
    }
    return `The request was rejected: ${error.message.slice(0, 200)}`
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return `The reading did not finish within ${TIMEOUT_MS / 1000}s. Try fewer screenshots at once.`
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'The connection to the API failed.'
  }
  return error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)
}
