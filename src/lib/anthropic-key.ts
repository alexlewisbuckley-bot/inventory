/**
 * The API key, and what to say when it is refused.
 *
 * Alex, dropping a photograph on the intake form: "They could not be read —
 * the API key was rejected — check ANTHROPIC_API_KEY in the deployment."
 *
 * That message is true and almost useless. The key is set, or the feature
 * would not have offered itself; it is set to something the API will not
 * accept. Which of the half-dozen reasons for that it is cannot be seen from
 * a hosted deployment, and nobody can paste the value anywhere to find out.
 *
 * So the shape of the value is read back instead. Length, the public prefix,
 * whether somebody's paste brought quotation marks with it — none of which
 * is secret, all of which distinguishes a truncated paste from a revoked key
 * from an admin key used by mistake.
 */

/** The prefix every Messages-API key carries. Not a secret. */
const PREFIX = 'sk-ant-'

/**
 * A key as the API should receive it.
 *
 * The SDK already trims whitespace, so a trailing newline was never the
 * problem. It does not strip quotation marks, and a value saved as
 * "sk-ant-..." — quotes and all — is what a .env line copied into a hosting
 * dashboard turns into. The API sees the quotes, rejects the key, and says
 * only that it is invalid.
 *
 * Only a matching pair is removed, and only from the outside. A quote
 * anywhere else is left alone to be reported rather than silently repaired.
 */
export function normaliseApiKey(raw: string | undefined | null): string | undefined {
  const trimmed = raw?.trim()
  if (!trimmed) return undefined
  const unquoted = /^(["'])(.*)\1$/s.exec(trimmed)
  const value = (unquoted ? unquoted[2] : trimmed).trim()
  return value || undefined
}

/** The configured key, ready to hand to the SDK. */
export function anthropicKey(): string | undefined {
  return normaliseApiKey(process.env.ANTHROPIC_API_KEY)
}

/** Whether there is a key to try at all. */
export function anthropicConfigured(): boolean {
  return Boolean(anthropicKey())
}

/**
 * What is wrong with the key, in words somebody can act on.
 *
 * Called only once the API has refused it, so the question is never "is this
 * valid" — it is "what is in the box". Says nothing that would matter if it
 * were read over somebody's shoulder: a length, a prefix every key shares,
 * and the characters that should not be there.
 */
export function describeApiKeyProblem(raw: string | undefined | null): string {
  const trimmed = raw?.trim() ?? ''
  if (!trimmed) return 'no key is set on the deployment at all'

  const key = normaliseApiKey(raw) ?? ''

  // Checked before the prefix, because a quoted key has the wrong prefix for
  // the obvious reason and saying so would send somebody after the wrong fault.
  if (key !== trimmed) {
    return 'the value is wrapped in quotation marks — save it without them'
  }
  if (/\s/.test(key)) {
    return 'the value has a space or line break inside it, so it was probably pasted in two pieces'
  }
  if (key.startsWith(`${PREFIX}admin`)) {
    return 'that is an admin key, which cannot be used for this — issue a normal API key instead'
  }
  if (!key.startsWith(PREFIX)) {
    // Four characters of a value that is not a key, which is enough to
    // recognise a project id or a pasted URL and not enough to be worth
    // anything if it is.
    return `the value does not look like an Anthropic key: it starts "${key.slice(0, 4)}…" rather than "${PREFIX}"`
  }
  if (key.length < 40) {
    return `the key looks cut short at ${key.length} characters — paste the whole of it`
  }

  // Nothing wrong with it to see, which is itself the answer: the fault is
  // with the key rather than with how it was entered.
  return `the key is well formed (${PREFIX}…, ${key.length} characters), so it has been revoked, `
    + 'belongs to another organisation, or the deployment has not been rebuilt since it changed'
}
