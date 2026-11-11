import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { anthropicConfigured, describeApiKeyProblem, normaliseApiKey } from '@/lib/anthropic-key'

const read = (path: string) => readFileSync(path, 'utf8')
const SERVICES = [
  'src/server/services/invoice-ai.ts',
  'src/server/services/gap-ai.ts',
  'src/server/services/watch-ai.ts',
  'src/server/services/xero-vision.ts',
] as const

/**
 * "The API key was rejected — check ANTHROPIC_API_KEY in the deployment."
 *
 * Alex got that dropping a photograph on the intake form. It is true and
 * almost useless: the key is set, or the feature would not have offered
 * itself, so the only question left is what is in the box — and on a hosted
 * deployment nobody can look, nor should they paste the value anywhere to
 * find out.
 *
 * So the value's shape answers instead. None of it is secret: a length, the
 * prefix every key shares, and the characters that should not be there.
 */

const KEY = `sk-ant-${'a'.repeat(80)}`

describe('a key as the API should receive it', () => {
  it('survives the whitespace a paste brings with it', () => {
    expect(normaliseApiKey(`  ${KEY}\n`)).toBe(KEY)
  })

  it('loses the quotation marks a .env line brings with it', () => {
    /*
     * The one fault worth repairing rather than reporting. A hosting
     * dashboard given `ANTHROPIC_API_KEY="sk-ant-..."` saves the quotes as
     * part of the value; the SDK trims whitespace and not those, so the API
     * sees them, rejects the key, and says only that it is invalid.
     */
    expect(normaliseApiKey(`"${KEY}"`)).toBe(KEY)
    expect(normaliseApiKey(`'${KEY}'`)).toBe(KEY)
    expect(normaliseApiKey(` "${KEY}" `)).toBe(KEY)
  })

  it('leaves a quote that is not a wrapper alone', () => {
    // Only a matching outer pair. A stray quote is a fault to report, not
    // one to quietly repair into a different wrong key.
    expect(normaliseApiKey(`"${KEY}`)).toBe(`"${KEY}`)
    expect(normaliseApiKey(`${KEY}'`)).toBe(`${KEY}'`)
  })

  it('counts a value with nothing in it as no key', () => {
    for (const empty of [undefined, null, '', '   ', '""', "''"]) {
      expect(normaliseApiKey(empty), JSON.stringify(empty)).toBeUndefined()
    }
  })
})

describe('what to say once the API has refused it', () => {
  const problem = describeApiKeyProblem

  it('names the quotation marks', () => {
    expect(problem(`"${KEY}"`)).toMatch(/wrapped in quotation marks/)
  })

  it('names a paste that arrived in two pieces', () => {
    expect(problem(`sk-ant-aaa bbb${'c'.repeat(60)}`)).toMatch(/space or line break inside/)
  })

  it('names an admin key, which is a different thing entirely', () => {
    expect(problem(`sk-ant-admin${'a'.repeat(70)}`)).toMatch(/admin key/)
  })

  it('names a value that is not a key at all', () => {
    const said = problem('https://console.anthropic.com/settings/keys')
    expect(said).toMatch(/does not look like an Anthropic key/)
    // Four characters of it, which recognises a URL and is worth nothing if
    // the value turns out to be a secret after all.
    expect(said).toContain('"http…"')
  })

  it('names a key that was cut short', () => {
    expect(problem('sk-ant-abc123')).toMatch(/cut short at 13 characters/)
  })

  it('says the entry is fine when it is, because that is the answer', () => {
    /*
     * Nothing wrong to see is itself a finding: the fault is the key rather
     * than how it was typed, which points at a revoked key or a deployment
     * that has not been rebuilt since it changed — a different errand from
     * re-reading the value.
     */
    const said = problem(KEY)
    expect(said).toMatch(/well formed/)
    expect(said).toMatch(/revoked|another organisation|rebuilt/)
  })

  it('says so plainly when there is nothing set', () => {
    expect(problem(undefined)).toMatch(/no key is set/)
  })

  it('never prints the key', () => {
    // The whole point of reading the shape instead of the value.
    for (const said of [problem(KEY), problem(`"${KEY}"`), problem(`sk-ant-admin${'a'.repeat(70)}`)]) {
      expect(said).not.toContain('aaaa')
      expect(said.length).toBeLessThan(200)
    }
  })
})

describe('every service that holds a key', () => {
  it('hands the SDK the normalised one rather than the raw variable', () => {
    // The SDK reads the environment itself if you let it, and it does not
    // strip quotes. Passing the value explicitly is what makes the repair
    // above reach the request.
    for (const path of SERVICES) {
      expect(read(path), path).toMatch(/apiKey: anthropicKey\(\)/)
    }
  })

  it('decides it is configured from the same normalised value', () => {
    // So a variable holding only quotation marks reads as absent — the
    // feature stays hidden — instead of as present and then rejected.
    for (const path of SERVICES) {
      expect(read(path), path).toMatch(/return anthropicConfigured\(\)/)
      expect(read(path), path).not.toMatch(/Boolean\(process\.env\.ANTHROPIC_API_KEY\)/)
    }
    expect(anthropicConfigured()).toBe(Boolean(normaliseApiKey(process.env.ANTHROPIC_API_KEY)))
  })

  it('says what is in the box when the key is refused', () => {
    for (const path of SERVICES) {
      expect(read(path), path).toMatch(/describeApiKeyProblem\(process\.env\.ANTHROPIC_API_KEY\)/)
      expect(read(path), path).not.toMatch(/rejected — check ANTHROPIC_API_KEY/)
    }
  })
})
