import Anthropic from '@anthropic-ai/sdk'
import { coerceExtraction, type ExtractedInvoice } from '@/lib/invoice'
import { CURRENCIES, PRODUCT_TYPES, VAT_SCHEMES } from '@/lib/enums'
import { logger } from '@/lib/logger'

/**
 * Reading an invoice with Claude.
 *
 * The rule-based parser handles invoices whose layout it has seen; this
 * handles the rest, which in practice is most of them — every dealer's
 * template is different, half of them put the reference in a sentence, and a
 * scan has no text layer for a regular expression to work on at all. Claude
 * reads the document itself, so a photographed invoice works the same as a
 * generated one.
 *
 * Optional by construction. With no API key configured this returns null and
 * the caller carries on with the rules, because an unconfigured key should
 * mean a worse read, not a broken upload.
 */

/**
 * Under Vercel's Hobby ceiling of 60s for a function.
 *
 * A timeout here is not a failure: the caller still has the rule-based
 * reading, so the invoice is booked in from that rather than rejected.
 */
const TIMEOUT_MS = 50_000

const MODEL = 'claude-opus-5'

/** The document types worth sending. Anything else goes to the rules alone. */
const DOCUMENT_TYPES = new Set(['application/pdf'])
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/**
 * Absent text is an empty string, not null.
 *
 * A strict schema allows at most 16 union-typed parameters, and declaring
 * every field `["string", "null"]` came to 18 — a 400 on every request, which
 * the caller then swallowed as "Claude unavailable" and quietly answered from
 * the rule-based parser instead. Text uses "" for "the invoice does not say"
 * and `coerceExtraction` turns that back into null.
 */
const absentAsEmpty = (description: string) => ({
  type: 'string',
  description: `${description} Empty string if the invoice does not state it.`,
})

/**
 * Numbers stay nullable, and are worth two of the sixteen.
 *
 * Zero is a real answer on an invoice — a margin-scheme sale states VAT of
 * £0.00 — so "not stated" cannot be encoded as 0 without losing the
 * difference between no VAT and no VAT line.
 */
const nullableNumber = (description: string) => ({ type: ['number', 'null'], description })

/**
 * The shape the answer must take.
 *
 * `strict` makes the API enforce it, which is the difference between parsing a
 * reply and receiving a record: no prose, no markdown fences, no field
 * invented on the fly. Every property is required and explicitly nullable, so
 * "the invoice does not say" is a value Claude can return rather than a reason
 * to guess.
 */
const INVOICE_TOOL: Anthropic.Beta.BetaToolUnion = {
  name: 'record_invoice',
  description:
    'Record every fact read from this supplier invoice for luxury watches. '
    + 'Leave text empty and numbers null for anything the document does not state — never invent a value.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      supplier: {
        type: 'object',
        additionalProperties: false,
        description: 'The firm that SENT the invoice — the seller, not the buyer.',
        properties: {
          name: absentAsEmpty('Trading name of the seller.'),
          legalName: absentAsEmpty('Registered entity, e.g. "GB Luxury Trading Limited".'),
          vatNo: absentAsEmpty('VAT registration number, digits and country prefix as printed.'),
          registrationNo: absentAsEmpty('Company registration number.'),
          email: absentAsEmpty("The seller's email address."),
          phone: absentAsEmpty("The seller's telephone number."),
          country: absentAsEmpty('Country the seller trades from.'),
        },
        required: ['name', 'legalName', 'vatNo', 'registrationNo', 'email', 'phone', 'country'],
      },
      invoiceNo: absentAsEmpty('The invoice number as printed.'),
      invoiceDate: absentAsEmpty('Invoice date as ISO YYYY-MM-DD. British invoices are day-first.'),
      currency: {
        type: 'string',
        enum: [...CURRENCIES],
        description: 'Currency the invoice is denominated in.',
      },
      netAmount: nullableNumber('Total before VAT, in the invoice currency.'),
      vatAmount: nullableNumber('VAT charged, in the invoice currency.'),
      grossAmount: nullableNumber('Total payable, in the invoice currency.'),
      vatScheme: {
        type: 'string',
        enum: [...VAT_SCHEMES],
        description:
          'MARGIN when the invoice mentions the second-hand margin scheme or global accounting; '
          + 'STANDARD for ordinary 20% VAT; ZERO_RATED for exports; REVERSE_CHARGE where stated; '
          + 'UNKNOWN when the document does not say.',
      },
      lines: {
        type: 'array',
        description: 'One entry per item sold. A single invoice may list several watches.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            description: { type: 'string', description: 'The line as printed, verbatim.' },
            brand: absentAsEmpty('Maker, e.g. Rolex, Patek Philippe, Cartier.'),
            reference: absentAsEmpty(
              "The manufacturer's reference, e.g. 126711CHNR, 5711/1A. Not the serial number.",
            ),
            serial: absentAsEmpty('The serial or case number unique to this individual watch.'),
            year: nullableNumber('Year of manufacture, if stated.'),
            productType: {
              type: 'string',
              enum: [...PRODUCT_TYPES],
              description: 'WATCH unless the line is plainly jewellery, a handbag or an accessory.',
            },
            unitAmount: nullableNumber('Price of this line before VAT, in the invoice currency.'),
            vatAmount: nullableNumber('VAT on this line, if broken out.'),
            quantity: { type: 'number', description: 'Units on this line. Usually 1.' },
          },
          required: [
            'description', 'brand', 'reference', 'serial', 'year',
            'productType', 'unitAmount', 'vatAmount', 'quantity',
          ],
        },
      },
    },
    required: [
      'supplier', 'invoiceNo', 'invoiceDate', 'currency',
      'netAmount', 'vatAmount', 'grossAmount', 'vatScheme', 'lines',
    ],
  },
}

const SYSTEM = `You read supplier invoices for a dealer in second-hand luxury watches and record what they say.

Rules that matter more than they look:
- The supplier is whoever SENT the invoice. The letterhead is the seller; "Invoice to" / "Bill to" is the buyer. Never return the buyer as the supplier.
- The reference and the serial are different things. A reference identifies the model and repeats across many watches (126711CHNR); a serial identifies one individual watch and never repeats. If only one is present, decide which it is from context rather than filling both.
- One line per watch. An invoice for three watches is three entries, even where the layout runs them together, and even where they share a price.
- Prices are per line and exclude VAT unless the invoice says otherwise. If only a VAT-inclusive figure is given for a line, use it and record the scheme.
- The VAT scheme is a legal fact about the sale, not a guess. Only report one the document supports.
- Anything not stated is empty: "" for text, null for numbers. A plausible invention is worse than a gap, because a gap is visible and an invention is not.`

export async function extractWithClaude(
  file: { name: string; mimeType: string; buffer: ArrayBuffer },
  text: string | null,
): Promise<ExtractedInvoice | null> {
  if (!aiConfigured()) return null

  const content: Anthropic.Beta.BetaContentBlockParam[] = []

  if (DOCUMENT_TYPES.has(file.mimeType)) {
    content.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: Buffer.from(file.buffer).toString('base64'),
      },
    })
  } else if (IMAGE_TYPES.has(file.mimeType)) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: file.mimeType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
        data: Buffer.from(file.buffer).toString('base64'),
      },
    })
  }

  // The extracted text goes alongside the document rather than instead of it:
  // it costs little and it is what carries a text-only upload (.txt, .csv) or
  // a PDF whose pages Claude reads better with the raw strings to hand.
  if (text?.trim()) {
    content.push({ type: 'text', text: `Text layer extracted from ${file.name}:\n\n${text.slice(0, 120_000)}` })
  }

  if (content.length === 0) return null
  content.push({ type: 'text', text: 'Record every watch on this invoice by calling record_invoice.' })

  const client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 })

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16_000,
      output_config: { effort: 'low' },
      // A refusal would leave the upload with nothing to show for itself; the
      // server-side fallback re-runs the same request on another model inside
      // the same call rather than returning empty-handed.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      tools: [INVOICE_TOOL],
      messages: [{ role: 'user', content }],
    })

    const call = response.content.find((block) => block.type === 'tool_use')
    if (!call || call.name !== 'record_invoice') {
      logger.warn('invoice extraction returned no tool call', {
        file: file.name, stopReason: response.stop_reason,
      })
      return null
    }

    const extraction = coerceExtraction(call.input)
    logger.info('invoice read by claude', {
      file: file.name,
      lines: extraction?.lines.length ?? 0,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    })
    return extraction
  } catch (error) {
    // Every failure here is survivable: the caller still has the rule-based
    // reading. Logged rather than raised so a rate limit or a lapsed key does
    // not turn into a failed upload.
    logger.warn('invoice extraction failed, falling back to pattern matching', {
      file: file.name,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
