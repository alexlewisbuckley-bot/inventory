'use server'
import Anthropic from '@anthropic-ai/sdk'
import { requireCapability } from '@/server/auth/session'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { anthropicConfigured, anthropicKey, describeApiKeyProblem } from '@/lib/anthropic-key'
import { recordUsage } from '@/server/services/ai-usage'
import { logger } from '@/lib/logger'

export interface KeyTestResult {
  ok: boolean
  message: string
}

/**
 * The smallest question that proves a key works.
 *
 * Alex: "why does the claude API keep going off and how do i retain it in
 * the system to work for AI based work."
 *
 * The honest answer to the first half is that nothing in the application
 * ever asked until somebody dropped a file on it, so a key that lapsed on a
 * Tuesday was discovered on a Thursday by somebody trying to book in a
 * watch. This asks on demand, from a page, which turns "it keeps going off"
 * into something with a date on it.
 *
 * Costs about a hundredth of a cent: eight tokens in, one out, on the
 * cheapest model there is. The question is whether the credentials work, and
 * no model answers that better than another.
 */
const TEST_MODEL = 'claude-haiku-5-5'

export async function testAnthropicKeyAction(): Promise<KeyTestResult> {
  const actor = await requireCapability('settings:manage')
  // Its own ceiling: a button that makes a request is a button somebody can
  // lean on, and this one deliberately runs outside the monthly budget so
  // that a spent budget can still be diagnosed.
  rateLimit({ key: `keytest:${actor.id}`, ...LIMITS.read })

  if (!anthropicConfigured()) {
    return {
      ok: false,
      message: 'No API key is set on this deployment, so the AI features are switched off rather than broken.',
    }
  }

  try {
    const client = new Anthropic({ apiKey: anthropicKey(), timeout: 20_000, maxRetries: 0 })
    const response = await client.messages.create({
      model: TEST_MODEL,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'Reply with the word ok.' }],
    })
    await recordUsage({
      feature: 'invoice',
      model: TEST_MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      ok: true,
      actorId: actor.id,
    })
    return { ok: true, message: 'The key works. The AI features have what they need.' }
  } catch (error) {
    const message = explain(error)
    logger.warn('anthropic key test failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    await recordUsage({
      feature: 'invoice', model: TEST_MODEL, ok: false, error: message, actorId: actor.id,
    })
    return { ok: false, message }
  }
}

/**
 * Why it did not work, in the terms that decide what to do next.
 *
 * The three that matter are different errands: the key is wrong, the money
 * has run out, or the account cannot use the model. Each used to arrive as
 * the same shrug.
 */
function explain(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return `The key was rejected: ${describeApiKeyProblem(process.env.ANTHROPIC_API_KEY)}.`
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return 'The key is valid but not permitted to use this model. Check the workspace it belongs to.'
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Rate limited, or the credit balance is empty. Check the balance on the Anthropic console first — '
      + 'an exhausted balance is the commonest reason these features stop working.'
  }
  if (error instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(error.message)) {
      return 'The credit balance on the Anthropic account is too low. Top it up and this starts working again '
        + 'immediately — no redeploy needed.'
    }
    if (/anthropic-workspace-id/i.test(error.message)) {
      return 'This key belongs to a person rather than a workspace, so it must name one. '
        + 'Set ANTHROPIC_WORKSPACE_ID on the deployment, or issue a workspace-scoped key.'
    }
    return `The request was rejected: ${error.message.slice(0, 200)}`
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'The connection to the API failed. That is a network problem rather than a key problem.'
  }
  return error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)
}
