import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SETTING_SPECS } from '@/lib/settings-specs'
import { THEMES } from '@/lib/enums'

const validatorFor = (key: string) => SETTING_SPECS.find((s) => s.key === key)!.validate!

describe('settings validation', () => {
  /**
   * Exchange rates are managed in Settings → Currencies, against the base.
   * A second rate field here was inert once the base moved to dollars — it
   * read as the knob that converts purchases while converting nothing, which
   * is worse than not offering it at all.
   */
  it('offers no second place to set an exchange rate', () => {
    expect(SETTING_SPECS.find((s) => s.key === 'finance.fxGbpUsd')).toBeUndefined()
    expect(SETTING_SPECS.filter((s) => /rate/i.test(s.label))).toEqual([])
  })

  it('bounds the target margin to a percentage', () => {
    const margin = validatorFor('finance.targetMarginPct')
    expect(margin('-1')).toBeTruthy()
    expect(margin('101')).toBeTruthy()
    expect(margin('8')).toBeNull()
  })

  it('requires whole days for the ageing threshold', () => {
    const ageing = validatorFor('inventory.ageingWarningDays')
    expect(ageing('0')).toBeTruthy()
    expect(ageing('90.5')).toBeTruthy()
    expect(ageing('90')).toBeNull()
  })
})

/**
 * Which theme somebody gets for never having chosen.
 *
 * Alex, on a phone whose operating system is in dark mode: "Please update
 * to light mode only mine is showing black I don't like it being black or
 * at least have light as default and dark mode as a selection."
 */
describe('the theme nobody chose', () => {
  const read = (path: string) => readFileSync(path, 'utf8')
  const provider = read('src/components/ui/ThemeProvider.tsx')

  it('is light, in the provider and in the script that runs before paint', () => {
    // Both, because they decide the same thing twice: the script paints the
    // first frame and React takes over after it. They disagreed once and
    // that is a flash of the wrong colour on every load.
    expect(provider).toMatch(/initial = 'LIGHT'/)
    expect(provider).toMatch(/\|\| 'LIGHT'/)
  })

  it('is light in the column too, and for the rows already written', () => {
    /*
     * Everyone on SYSTEM today is on it by not having picked, so leaving
     * those rows alone would mean the change reached nobody.
     */
    const schema = read('src/server/db/schema.ts')
    expect(schema).toMatch(/theme: text\('theme', \{ enum: THEMES \}\)\.notNull\(\)\.default\('LIGHT'\)/)

    const migration = read('src/server/db/migrations/0078_light_by_default.sql')
    expect(migration).toMatch(/ALTER COLUMN theme SET DEFAULT 'LIGHT'/)
    expect(migration).toMatch(/UPDATE user_preferences SET theme = 'LIGHT' WHERE theme = 'SYSTEM'/)
  })

  it('starts every browser again, rather than reading the old answer', () => {
    /*
     * Every browser that has loaded this holds "SYSTEM" under the old key —
     * written by the provider, not chosen by a person. Changing the default
     * alone would have reached nobody who had already visited.
     */
    expect(provider).toMatch(/const STORAGE_KEY = 'bluecroft\.theme\.v2'/)
    expect(provider).toMatch(/localStorage\.getItem\('bluecroft\.theme\.v2'\)/)
  })

  it('still offers dark, and system, as choices', () => {
    // "or at least have light as default and dark mode as a selection."
    expect(THEMES).toEqual(['LIGHT', 'DARK', 'SYSTEM'])
    const toggle = read('src/components/ui/ThemeToggle.tsx')
    for (const option of ['LIGHT', 'DARK', 'SYSTEM']) expect(toggle).toContain(`'${option}'`)
    // And SYSTEM still means the operating system, not a second light.
    expect(provider).toMatch(/t === 'SYSTEM' && window\.matchMedia/)
  })

  it('tells the browser which scheme its own controls are in', () => {
    /*
     * Left unset, the operating system styles the parts of the page it owns
     * — scrollbars, the date picker, the inside of a select — in dark, on a
     * light page. That is where a light theme on a dark phone stops looking
     * light and starts looking broken.
     */
    expect(provider).toMatch(/root\.style\.colorScheme = dark \? 'dark' : 'light'/)
  })
})
