import Anthropic from '@anthropic-ai/sdk'
import { logger } from '@/lib/logger'
import {
  acceptProposals,
  type GapField,
  type GapRow,
  type Proposal,
  type Suggestion,
} from '@/lib/gap-suggestions'

/**
 * Asking Claude about a reference the book has never held.
 *
 * The second tier, and the smaller one. `suggestFromBook` answers from the
 * business's own records wherever it can, because eight watches already filed
 * as Datejust 41 are better evidence about a ninth than anybody's
 * recollection. This is for the rest: a reference arriving for the first time,
 * with nothing to compare it to.
 *
 * Optional by construction, like the invoice reader it is modelled on. With no
 * API key this returns nothing and the worklist is simply the shorter one the
 * book could answer — an unconfigured key should mean fewer suggestions, not a
 * broken page.
 *
 * Two things keep it honest, and they are different in kind:
 *
 *   The prompt ASKS it to choose a family from the shop's own list.
 *   `knownFamily` REQUIRES it, afterwards, and drops anything else.
 *
 * The second is the one that matters. A prompt is a request and a model under
 * pressure to be helpful will invent a plausible family for a reference it
 * does not know. Checking the answer against the forty-two entries the shop
 * actually holds is what makes "do not guess" a rule rather than a hope.
 */

/** Under Vercel's 60s ceiling, with room for the page around it. */
const TIMEOUT_MS = 45_000

const MODEL = 'claude-opus-5'

/**
 * One call, not one per watch.
 *
 * A batch is cheaper and it is also more accurate: twenty references in front
 * of it at once, half of them Rolex sports models, is context a single lonely
 * `86348SAJOR` does not have. Capped so a first run against a large import
 * cannot become a thirty-thousand-token request.
 */
const MAX_BATCH = 40

export function gapAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/** Keys issued against a person must name their workspace; see invoice-ai. */
function workspaceHeaders(): Record<string, string> | undefined {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim()
  return workspace ? { 'anthropic-workspace-id': workspace } : undefined
}

const SYSTEM = `You identify wristwatch models from their manufacturer reference numbers, for a Dubai dealer's stock book.

You will be given watches whose model name or case size has not been recorded, and the exact vocabulary the dealer's website uses.

Rules, in order of importance:

1. Choose the family from the supplied list, copied exactly. Never invent one. If the correct family is not on the list, return an empty string for it — that is a useful answer and the right one.
2. Say "low" confidence unless the reference is one you genuinely recognise. A reference you are reconstructing from its prefix is low confidence. There is no penalty for low confidence and a real cost to a wrong name reaching a live shop window.
3. Give the case size only as a whole number of millimetres, and only where the reference settles it. 0 otherwise.
4. Do not report a dial colour, and do not infer one. A reference does not determine a dial.
5. Reasoning is one short sentence a watch dealer would accept: what the reference is, and how you know.

Accuracy over coverage. Every answer is reviewed by a dealer who knows these watches, and a confident wrong answer wastes more of their time than no answer at all.`

const TOOL: Anthropic.Tool = {
  name: 'propose_models',
  description: 'Report the family and case size for each watch you can identify from its reference.',
  input_schema: {
    type: 'object',
    properties: {
      proposals: {
        type: 'array',
        description: 'One entry per watch you were given. Include every watch, even where you know nothing.',
        items: {
          type: 'object',
          properties: {
            stock_no: { type: 'integer', description: 'The stock number exactly as supplied.' },
            family: {
              type: 'string',
              description:
                'The family, copied exactly from the supplied list of families. Empty string if the right one is not on the list or you do not recognise the reference.',
            },
            case_size_mm: {
              type: 'integer',
              description: 'Case diameter in whole millimetres. 0 if the reference does not settle it.',
            },
            confidence: {
              type: 'string',
              enum: ['high', 'low'],
              description: 'high only for a reference you genuinely recognise.',
            },
            reasoning: { type: 'string', description: 'One short sentence: what it is and how you know.' },
          },
          required: ['stock_no', 'family', 'case_size_mm', 'confidence', 'reasoning'],
        },
      },
    },
    required: ['proposals'],
  },
}

export interface GapAiResult {
  suggestions: Suggestion[]
  /** Why nothing came back, for the page to show rather than failing silently. */
  error: string | null
  /** How many Claude was asked about, so "nothing found" can be told from "nothing asked". */
  asked: number
}

export async function suggestFromClaude(
  items: Array<{ row: GapRow; fields: GapField[] }>,
  choices: Record<string, string[]>,
): Promise<GapAiResult> {
  if (!gapAiConfigured()) return { suggestions: [], error: null, asked: 0 }
  if (!items.length) return { suggestions: [], error: null, asked: 0 }

  // Nothing to check an answer against means nothing can be offered safely.
  // The shop being unreachable is a reason to show no suggestions, not a
  // reason to show unchecked ones.
  if (!choices.model?.length) {
    return { suggestions: [], error: 'the shop’s model list could not be read, so nothing could be checked', asked: 0 }
  }

  const batch = items.slice(0, MAX_BATCH)
  const byStock = new Map(batch.map((item) => [item.row.stockNo, item]))

  const asked = batch
    .map((item) => {
      const wants = item.fields.map((f) => (f === 'nickname' ? 'model name' : 'case size')).join(' and ')
      return `- stock ${item.row.stockNo}: ${item.row.brandName} reference ${item.row.model} — missing ${wants}`
    })
    .join('\n')

  const prompt = [
    `Families the website uses (choose only from these, copied exactly):\n${choices.model.join('\n')}`,
    choices.case_size?.length
      ? `\nCase sizes the website can store:\n${choices.case_size.join(', ')}`
      : '',
    `\nWatches:\n${asked}`,
    '\nCall propose_models with one entry per watch.',
  ].join('\n')

  const client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1, defaultHeaders: workspaceHeaders() })

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8_000,
      system: SYSTEM,
      tools: [TOOL],
      messages: [{ role: 'user', content: prompt }],
    })

    const call = response.content.find((block) => block.type === 'tool_use')
    if (!call || call.name !== 'propose_models') {
      return {
        suggestions: [],
        error: `no suggestions came back (stopped: ${response.stop_reason})`,
        asked: batch.length,
      }
    }

    const proposals = (call.input as { proposals?: Proposal[] }).proposals ?? []
    const { suggestions, dropped } = acceptProposals(proposals, batch, choices)

    logger.info('gap suggestions from claude', {
      asked: batch.length,
      returned: proposals.length,
      offered: suggestions.length,
      dropped,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    })

    return { suggestions, error: null, asked: batch.length }
  } catch (error) {
    // Survivable in every case: the book's own suggestions are already on the
    // page and the gaps were visible before this feature existed. The reason
    // is carried out because these have different fixes.
    logger.warn('gap suggestions failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { suggestions: [], error: describeFailure(error), asked: batch.length }
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'the API key was rejected — check ANTHROPIC_API_KEY in the deployment'
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
