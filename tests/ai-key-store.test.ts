import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { open, seal } from '@/server/auth/secret-box'
import { hintFor } from '@/server/services/ai-key-service'
import { SETTING_SPECS } from '@/lib/settings-specs'

const read = (path: string) => readFileSync(path, 'utf8')
const service = read('src/server/services/ai-key-service.ts')
const action = read('src/app/actions/ai-key.ts')
const page = read('src/app/(app)/settings/ai/page.tsx')
const form = read('src/components/settings/ConnectAiKey.tsx')

const KEY = `sk-ant-api03-${'x'.repeat(95)}`

/**
 * Connecting a key from the application rather than the deployment.
 *
 * Alex, after the diagnostic reported his key well formed and still
 * refused: "Can we add a setting and intsturctions to connect the API key."
 *
 * The key could only come from an environment variable, which this host
 * reads when the application is built — so changing it did nothing until the
 * next deploy. The least obvious of the reasons these features stop, because
 * everything looks correctly configured while the running copy holds the old
 * value.
 */

describe('a secret, sealed', () => {
  beforeAll(() => {
    // The derivation needs one; the value is irrelevant to the behaviour.
    process.env.AUTH_SECRET ??= 'a'.repeat(40)
  })

  it('round-trips', () => {
    expect(open(seal(KEY))).toBe(KEY)
  })

  it('does not carry the secret in the stored form', () => {
    // The whole point: a backup, a staging dump or a bug report carries
    // nothing usable on its own.
    const sealed = seal(KEY)
    expect(sealed).not.toContain(KEY)
    expect(sealed).not.toContain(KEY.slice(13, 40))
  })

  it('seals the same value differently every time', () => {
    // A fresh nonce each time, so two keys that happen to match cannot be
    // recognised as matching by looking at the rows.
    expect(seal(KEY)).not.toBe(seal(KEY))
  })

  it('refuses to open a row that has been tampered with', () => {
    /*
     * GCM authenticates as well as encrypts, so an altered row fails to open
     * rather than opening onto something else. Null, not a throw: the caller
     * already handles "there is no usable key", and an exception would take
     * out a page that was only asking whether a feature is switched on.
     */
    const sealed = seal(KEY)
    expect(open(`${sealed.slice(0, -4)}AAAA`)).toBeNull()
    expect(open('v1.a.b.c')).toBeNull()
    expect(open('v9.a.b.c')).toBeNull()
    expect(open('nonsense')).toBeNull()
    expect(open(null)).toBeNull()
  })
})

describe('what may be shown about a key', () => {
  it('is a shared prefix and a length, and nothing else', () => {
    const hint = hintFor(KEY)
    expect(hint).toBe('sk-ant-… · 108 characters')
    expect(hint).not.toContain(KEY.slice(13, 30))
  })

  it('is the only thing the page is given', () => {
    /*
     * keyStatus is what the server component hands to the browser. It
     * carries the source, the hint and a date — never the secret, which
     * never leaves the module that reads it.
     */
    const body = service.slice(service.indexOf('export async function keyStatus'))
    const end = body.indexOf('\nexport ', 10)
    expect(body.slice(0, end)).not.toMatch(/secret: row\.secret|return.*opened/)
    expect(page).toMatch(/hint=\{key\.hint\}/)
    expect(page).not.toMatch(/secret/i)
  })
})

describe('which key is used', () => {
  it('prefers the one set here, because it is the one somebody chose last', () => {
    expect(service).toMatch(/return stored \?\? normaliseApiKey\(process\.env\.ANTHROPIC_API_KEY\)/)
  })

  it('falls back rather than failing when the stored one cannot be opened', () => {
    /*
     * A row sealed under a different AUTH_SECRET is the realistic case — a
     * restored database, a rotated secret. Falling back to the environment
     * is the kinder failure and the one that can be recovered from without
     * a database.
     */
    const body = service.slice(service.indexOf('async function storedKey'))
    expect(body).toMatch(/if \(!opened\)[\s\S]*return undefined/)
    expect(body).toMatch(/catch[\s\S]*return undefined/)
  })

  it('says where the key came from when it is refused', () => {
    // With two places a key can live, "the key was rejected" leaves somebody
    // to guess which one is in play — and the commonest next mistake is
    // setting it in the one being overridden.
    expect(service).toMatch(/set here, in Settings → AI and costs/)
    expect(service).toMatch(/from ANTHROPIC_API_KEY on the deployment/)
  })
})

describe('setting one', () => {
  it('is kept out of the settings table, and so out of the audit trail', () => {
    /*
     * updateSettings writes the old and new VALUES of every changed setting
     * into the audit trail, which is a page in this application, and
     * getSettings hands every setting to the form that renders them. A key
     * routed through either would be on screen.
     */
    expect(SETTING_SPECS.find((spec) => /key/i.test(spec.key))).toBeUndefined()
    expect(service).toMatch(/storedSecrets/)
  })

  it('records the hint in the audit trail, never the key', () => {
    expect(action).toMatch(/summary: `API key connected \(\$\{hintFor\(key\)\}\)`/)
    const audits = action.match(/recordAudit\(\{[\s\S]*?\}\)/g) ?? []
    expect(audits.length).toBeGreaterThan(0)
    for (const entry of audits) expect(entry).not.toMatch(/changes:/)
  })

  it('is checked against the API before it is kept', () => {
    /*
     * Saving a key that does not work, so that somebody finds out later by
     * dropping a photograph on a form, is how this whole sequence of
     * problems started.
     */
    const save = action.indexOf('const check = await tryKey')
    const store = action.indexOf('await saveAnthropicKey(key, actor)')
    expect(save).toBeGreaterThan(-1)
    expect(save).toBeLessThan(store)
    expect(action).toMatch(/if \(!check\.ok\) return \{ ok: false, errors: \{ key: check\.message \} \}/)
  })

  it('refuses the three shapes that cannot work, before sending anything', () => {
    for (const refusal of [/Paste the key before saving/, /begin "sk-ant-"/, /is an admin key/]) {
      expect(action).toMatch(refusal)
    }
  })

  it('tells somebody a valid key on an empty account is not a broken key', () => {
    // The commonest way these features stop, and the one case where nothing
    // about the key needs changing at all.
    expect(action).toMatch(/the account has no credit on it/)
  })

  it('never renders the key back', () => {
    // A password field, no autocomplete, and nothing on the page that could
    // carry the value into the browser.
    expect(form).toMatch(/type="password"/)
    expect(form).toMatch(/autoComplete="off"/)
  })

  it('says where to get one, and that it needs money on it', () => {
    expect(form).toMatch(/console\.anthropic\.com/)
    expect(form).toMatch(/not an admin key/)
    expect(form).toMatch(/credit on the account/)
  })
})
