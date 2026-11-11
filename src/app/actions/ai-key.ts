'use server'
import { revalidatePath } from 'next/cache'
import Anthropic from '@anthropic-ai/sdk'
import { requireCapability } from '@/server/auth/session'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { normaliseApiKey } from '@/lib/anthropic-key'
import { recordAudit } from '@/server/services/audit'
import { forgetAnthropicKey, hintFor, saveAnthropicKey } from '@/server/services/ai-key-service'
import { recordUsage } from '@/server/services/ai-usage'
import { logger } from '@/lib/logger'
import type { ActionState } from './auth'

/**
 * Connecting a key from the application rather than the deployment.
 *
 * Alex: "Can we add a setting and intsturctions to connect the API key."
 *
 * The key is checked against the API before it is kept. A key that does not
 * work is the thing this whole sequence of problems has been about, and
 * saving one so that somebody discovers it later, mid-task, by dropping a
 * photograph on a form, is how we got here. Better to refuse it while the
 * person who has the console open is still looking at this page.
 */
const TEST_MODEL = 'claude-haiku-5-5'

export async function saveAnthropicKeyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCapability('settings:manage')
  rateLimit({ key: `keyset:${actor.id}`, ...LIMITS.read })

  const key = normaliseApiKey(String(formData.get('key') ?? ''))
  if (!key) {
    return { ok: false, errors: { key: 'Paste the key before saving.' } }
  }
  if (!key.startsWith('sk-ant-')) {
    return {
      ok: false,
      errors: { key: 'That does not look like an Anthropic key — they begin "sk-ant-".' },
    }
  }
  if (key.startsWith('sk-ant-admin')) {
    return {
      ok: false,
      errors: { key: 'That is an admin key, which cannot read invoices or photographs. Issue a normal API key.' },
    }
  }

  // Asked of the API before it is kept, so a dud is refused here rather than
  // discovered a day later by somebody booking in a watch.
  const check = await tryKey(key, actor.id)
  if (!check.ok) return { ok: false, errors: { key: check.message } }

  try {
    await saveAnthropicKey(key, actor)
  } catch (error) {
    logger.error('could not store the Anthropic key', {
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      ok: false,
      message: 'The key works, but it could not be saved. AUTH_SECRET must be set on the deployment to store it.',
    }
  }

  // The hint, never the key. An audit trail that recorded the value would be
  // the leak this table was built to avoid.
  await recordAudit({
    entityType: 'StoredSecret', entityId: 'anthropic', action: 'UPDATE', actorId: actor.id,
    summary: `API key connected (${hintFor(key)})`,
  })
  revalidatePath('/settings/ai')
  return { ok: true, message: 'The key works and is connected. It takes effect immediately.' }
}

export async function forgetAnthropicKeyAction(): Promise<ActionState> {
  const actor = await requireCapability('settings:manage')
  rateLimit({ key: `keyset:${actor.id}`, ...LIMITS.read })

  await forgetAnthropicKey()
  await recordAudit({
    entityType: 'StoredSecret', entityId: 'anthropic', action: 'DELETE', actorId: actor.id,
    summary: 'API key removed',
  })
  revalidatePath('/settings/ai')
  return {
    ok: true,
    message: 'The key has been removed. Any ANTHROPIC_API_KEY set on the deployment is used again.',
  }
}

/** The smallest question that proves a key works: eight tokens in, one out. */
async function tryKey(key: string, actorId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const client = new Anthropic({ apiKey: key, timeout: 20_000, maxRetries: 0 })
    const response = await client.messages.create({
      model: TEST_MODEL,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'Reply with the word ok.' }],
    })
    await recordUsage({
      feature: 'invoice', model: TEST_MODEL, ok: true, actorId,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, message: refusal(error) }
  }
}

/**
 * Why the API would not take it, in the terms that decide what to do next.
 *
 * Deliberately specific about the credit balance: a valid key on an account
 * with no money on it is the commonest way these features stop, and it is
 * the one case where nothing about the key needs changing at all.
 */
function refusal(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'The API rejected that key. Check it was copied whole, and that it has not been revoked.'
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return 'That key is valid but not permitted to use the models this needs. Check which workspace it belongs to.'
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Rate limited, or the credit balance is empty. Check the balance on the Anthropic console.'
  }
  if (error instanceof Anthropic.BadRequestError && /credit balance/i.test(error.message)) {
    return 'That key is valid, but the account has no credit on it. Top it up and save again.'
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'The connection to the API failed, so the key could not be checked. Try again in a moment.'
  }
  return error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)
}
