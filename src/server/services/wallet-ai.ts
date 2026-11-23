import Anthropic from '@anthropic-ai/sdk'
import { anthropicConfigured, anthropicKey } from './ai-key-service'
import { recordUsage, spendingAllowed } from './ai-usage'
import { logger } from '@/lib/logger'
import { shortAddress } from '@/lib/usdt'
import type { Payable, Payment, Proposal } from '@/lib/wallet-match'

/**
 * The payments the rules could not place.
 *
 * Alex: "an inovative way to utilise AI and our USDT wallet addresses."
 *
 * The rules in `wallet-match` settle the ordinary cases and settle them with
 * certainty — an exact figure against one waiting invoice needs no model, and
 * putting one in front of it would make a reliable answer unreliable. What is
 * left over is the interesting part: a payment short by the exchange's
 * withdrawal fee, two invoices settled with a round number and the balance
 * carried, a payer whose name is on no invoice at all. That is reading, not
 * arithmetic, and it is what the model is for.
 *
 * Three rules keep it honest:
 *
 * Every proposal it returns is checked against the real payments and the real
 * invoices before it is shown. A model that invents an invoice number must
 * produce nothing, not a plausible-looking row on a reconciliation screen.
 *
 * Its confidence is capped below a rule's. "The model thought so" must never
 * outrank "the figures are identical", however sure the prose sounds.
 *
 * It proposes. It cannot approve, and the screen it feeds writes nothing
 * until a person says so.
 */

const MODEL = 'claude-opus-5-5'
const TIMEOUT_MS = 40_000

/** However sure it sounds, a read is worth less than matching figures. */
export const AI_CONFIDENCE_CEILING = 75

export interface AiReading {
  proposals: Proposal[]
  /** What it noticed that is not a link: worth saying, not worth acting on. */
  notes: string[]
  error: string | null
}

const EMPTY: AiReading = { proposals: [], notes: [], error: null }

export async function walletAiConfigured(): Promise<boolean> {
  return anthropicConfigured()
}

const TOOL: Anthropic.Beta.BetaToolUnion = {
  name: 'record_reconciliation',
  description:
    'Record which payments settle which invoices, and anything a bookkeeper should be told. '
    + 'Only use the ids given. Never invent a payment, an invoice or an amount.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      links: {
        type: 'array',
        description:
          'One entry per payment-to-invoice pairing you are confident about. '
          + 'Leave the array empty rather than guessing: an unmatched payment that a person '
          + 'looks at is a better outcome than a wrong one they trust.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            paymentId: { type: 'string', description: 'The id of the payment, exactly as given.' },
            invoiceId: { type: 'string', description: 'The id of the invoice, exactly as given.' },
            amountUsd: {
              type: 'number',
              description:
                'The part of the payment that settles this invoice, in whole cents. '
                + 'Never more than the payment has left.',
            },
            confidence: {
              type: 'number',
              description: '0 to 100. Be honest; a low number is useful, a wrong high one is not.',
            },
            reason: {
              type: 'string',
              description:
                'One sentence a bookkeeper can check, naming the figures. '
                + 'For example: "126,000 is 126,519 less a 519 withdrawal fee".',
            },
          },
          required: ['paymentId', 'invoiceId', 'amountUsd', 'confidence', 'reason'],
        },
      },
      notes: {
        type: 'array',
        description:
          'Things worth knowing that are not links: a payer who has never paid before sending '
          + 'a large sum, a payment that looks like a deposit on something not yet invoiced, '
          + 'a pattern across several transfers. One sentence each, at most four.',
        items: { type: 'string' },
      },
    },
    required: ['links', 'notes'],
  },
}

/**
 * What the model is told.
 *
 * Ids, figures and dates — and deliberately not the customer's email, phone
 * or address. A reconciliation needs to know that an address paid invoice
 * 1727 before; it does not need anybody's contact details, and sending them
 * to a third party because it was convenient is not a thing to do with a
 * customer book.
 */
function brief(payments: Payment[], payables: Payable[]): string {
  const money = (cents: number) => (cents / 100).toFixed(2)

  const lines = [
    'These USDT payments arrived in our wallets and our rules could not place them.',
    'Every figure is in US dollars. USDT is treated as a dollar.',
    '',
    'PAYMENTS WE CANNOT PLACE:',
    ...payments.map((payment) => [
      `- id=${payment.id}`,
      `amount=${money(payment.amountUsd - (payment.linkedUsd ?? 0))}`,
      `received=${payment.at.slice(0, 10)}`,
      `payer=${shortAddress(payment.counterparty)}`,
      payment.knownCustomerId ? 'this payer has settled invoices for this customer before' : 'payer not seen before',
    ].join(' ')),
    '',
    'INVOICES STILL WAITING:',
    ...payables.map((payable) => [
      `- id=${payable.id}`,
      `ref=${payable.reference}`,
      `outstanding=${money(payable.dueUsd)}`,
      `of=${money(payable.totalUsd)}`,
      `dated=${payable.at.slice(0, 10)}`,
      `customer=${payable.customerName ?? 'not recorded'}`,
      `for=${payable.label}`,
    ].join(' ')),
    '',
    'Account for what you can. An exchange taking a withdrawal fee out of the middle, a',
    'customer rounding to the nearest thousand, a round number paid against two invoices',
    'with the balance carried — these are the cases worth your attention. A payment that is',
    'simply not an invoice should be left alone and mentioned in the notes.',
  ]
  return lines.join('\n')
}

/**
 * Ask, then check every word of the answer.
 *
 * The validation below is not defensive habit: a model asked to match
 * payments to invoices will, under pressure, produce a well-formed pairing
 * for an invoice id that does not exist. On a reconciliation screen that is
 * indistinguishable from a real proposal, which is how wrong money gets
 * approved by somebody who was right to trust the tool.
 */
export async function readUnmatched(
  payments: Payment[], payables: Payable[],
): Promise<AiReading> {
  if (payments.length === 0 || payables.length === 0) return EMPTY
  if (!await anthropicConfigured()) return EMPTY

  const budget = await spendingAllowed()
  if (!budget.allowed) return { ...EMPTY, error: budget.reason }

  const client = new Anthropic({
    apiKey: await anthropicKey(),
    timeout: TIMEOUT_MS,
    maxRetries: 1,
  })

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4_000,
      output_config: { effort: 'low' },
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'record_reconciliation' },
      messages: [{ role: 'user', content: brief(payments, payables) }],
    })

    await recordUsage({
      feature: 'wallet-reconcile',
      model: MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      ok: true,
    })

    const block = response.content.find((part) => part.type === 'tool_use')
    if (!block || block.type !== 'tool_use') return EMPTY
    return validate(block.input, payments, payables)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.warn('the wallet reconciliation model could not be reached', { reason })
    await recordUsage({ feature: 'wallet-reconcile', model: MODEL, ok: false, error: reason })
    return { ...EMPTY, error: reason }
  }
}

/** Everything the model said, against what is actually on the board. */
export function validate(
  input: unknown, payments: Payment[], payables: Payable[],
): AiReading {
  const answer = (input ?? {}) as { links?: unknown; notes?: unknown }
  const byPayment = new Map(payments.map((payment) => [payment.id, payment]))
  const byPayable = new Map(payables.map((payable) => [payable.id, payable]))
  const spent = new Map<string, number>()

  const proposals: Proposal[] = []
  for (const row of Array.isArray(answer.links) ? answer.links : []) {
    if (!row || typeof row !== 'object') continue
    const link = row as Record<string, unknown>
    const payment = byPayment.get(String(link.paymentId ?? ''))
    const payable = byPayable.get(String(link.invoiceId ?? ''))
    // An id that is not on the board is the failure this exists to catch.
    if (!payment || !payable) {
      logger.warn('the model proposed a link to something that is not on the board', {
        paymentId: link.paymentId, invoiceId: link.invoiceId,
      })
      continue
    }

    const amount = Math.round(Number(link.amountUsd))
    if (!Number.isFinite(amount) || amount <= 0) continue

    // It may not spend a payment twice, nor more of it than arrived.
    const left = payment.amountUsd - (payment.linkedUsd ?? 0) - (spent.get(payment.id) ?? 0)
    const applied = Math.min(amount, left, payable.dueUsd)
    if (applied <= 0) continue
    spent.set(payment.id, (spent.get(payment.id) ?? 0) + applied)

    const confidence = Math.round(Number(link.confidence))
    proposals.push({
      paymentId: payment.id,
      kind: payable.kind,
      targetId: payable.id,
      amountUsd: applied,
      confidence: Math.max(
        1,
        Math.min(AI_CONFIDENCE_CEILING, Number.isFinite(confidence) ? confidence : 50),
      ),
      reason: typeof link.reason === 'string' && link.reason.trim()
        ? link.reason.trim()
        : 'Proposed by Claude from the figures',
    })
  }

  const notes = (Array.isArray(answer.notes) ? answer.notes : [])
    .filter((note): note is string => typeof note === 'string' && note.trim().length > 0)
    .map((note) => note.trim())
    .slice(0, 4)

  return { proposals, notes, error: null }
}
