/**
 * The design system, checked rather than asserted.
 *
 * Two independent sources of truth exist for colour: the CSS custom properties
 * in `globals.css`, which every component reads, and `src/lib/tokens.ts`,
 * which the code that has to *compute* with a colour reads. Neither can be
 * removed — CSS cannot pick the fifth series, and TypeScript cannot re-theme a
 * page with one class. So the duplication is deliberate, and this file is the
 * thing that makes it safe: if the two ever disagree, the build stops.
 *
 * The colour checks here are arithmetic, not opinion. Lightness monotonicity,
 * midpoint neutrality and contrast are computed from the hex, in OKLab and in
 * WCAG relative luminance, because a human looking at two swatches is exactly
 * the instrument that cannot tell whether a ramp is monotonic.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  CHART_CATEGORICAL, CHART_CATEGORICAL_NAMES, CHART_DIVERGING, CHART_SAFE_SLOTS,
  CHART_SEQUENTIAL, CHART_SURFACE, CONTROL_HEIGHT, DENSITY_Y, DURATION, EASING,
  MAX_DURATION, MIN_TOUCH_TARGET, STATUS_HEX, STATUS_SEVERITY, STATUS_TONES,
  needsSecondaryEncoding,
  CUSTOMER_STATUS_TONE, DEAL_STAGE_TONE, OFFER_STATUS_TONE, PAYMENT_STATUS_TONE,
  PRIORITY_TONE, REQUEST_STATUS_TONE, TASK_STATUS_TONE, WATCH_STATUS_TONE_V2,
  seriesColour, worstTone, type ThemeMode,
} from '@/lib/tokens'
import {
  ACTIVITY_DIRECTIONS, ACTIVITY_DIRECTION_LABELS, CUSTOMER_STATUSES, DEAL_STAGES,
  NOTIFICATION_TYPES, NOTIFICATION_TYPE_LABELS, OFFER_STATUSES, PAYMENT_STATUSES,
  PRIORITIES, REQUEST_STATUSES, TASK_STATUSES, TASK_STATUS_LABELS, WATCH_STATUSES,
} from '@/lib/enums'

// --- colour maths ----------------------------------------------------------

function toRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ]
}

/** sRGB channel to linear light. The gamma curve, not a 2.2 approximation. */
function linearise(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** OKLab. Perceptual, which is the only space in which "lighter" is a fact. */
function oklab(hex: string): { L: number; a: number; b: number; C: number } {
  const [r, g, bl] = toRgb(hex).map(linearise) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, a, b, C: Math.hypot(a, b) }
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map(linearise) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

// --- the stylesheet, parsed ------------------------------------------------

const CSS = readFileSync(resolve(__dirname, '../src/styles/globals.css'), 'utf8')

/**
 * Pull one theme block out of the stylesheet.
 *
 * Brace-counted rather than regex-matched to the first `}`: the light block
 * contains nested comments with braces in them, and a lazy regex silently
 * returns half a theme, which would make every "token missing" assertion below
 * pass for the wrong reason.
 */
function themeBlock(selector: string): string {
  const start = CSS.indexOf(selector)
  expect(start, `${selector} not found in globals.css`).toBeGreaterThan(-1)
  const open = CSS.indexOf('{', start)
  let depth = 0
  for (let i = open; i < CSS.length; i += 1) {
    if (CSS[i] === '{') depth += 1
    if (CSS[i] === '}') {
      depth -= 1
      if (depth === 0) return CSS.slice(open + 1, i)
    }
  }
  throw new Error(`Unbalanced braces after ${selector}`)
}

function declaredTokens(block: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of block.matchAll(/(--c-[\w-]+)\s*:\s*([^;]+);/g)) {
    found.set(match[1]!, match[2]!.trim())
  }
  return found
}

const LIGHT = declaredTokens(themeBlock(':root'))
const DARK = declaredTokens(themeBlock('.dark'))

/** `30 78 157` → `#1E4E9D`. The channels are stored space-separated so
 *  Tailwind's `<alpha-value>` can apply opacity to any token. */
function channelsToHex(channels: string): string {
  const parts = channels.split(/\s+/).map(Number)
  expect(parts).toHaveLength(3)
  return `#${parts.map((n) => n.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

function cssHex(mode: ThemeMode, token: string): string {
  const source = mode === 'light' ? LIGHT : DARK
  const value = source.get(token)
  expect(value, `${token} is not declared for ${mode}`).toBeTruthy()
  return channelsToHex(value!)
}

/** Every unordered pair of indices below `n`. */
function pairs(n: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) out.push([i, j])
  return out
}

/** OKLab ΔE, ×100 to match the scale the dataviz validator reports. */
function deltaE(a: string, b: string): number {
  const x = oklab(a)
  const y = oklab(b)
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b) * 100
}

const MODES: ThemeMode[] = ['light', 'dark']

// ---------------------------------------------------------------------------

describe('semantic tokens', () => {
  it('resolves every token in both themes', () => {
    // The failure this catches is a token added to `:root` and forgotten in
    // `.dark`, which does not throw — it inherits the light value and paints
    // near-white text on a near-black surface for whoever uses dark mode.
    const missingInDark = [...LIGHT.keys()].filter((token) => !DARK.has(token))
    expect(missingInDark).toEqual([])

    const strayInDark = [...DARK.keys()].filter((token) => !LIGHT.has(token))
    expect(strayInDark).toEqual([])
  })

  it('declares every token as three RGB channels', () => {
    for (const [mode, tokens] of [['light', LIGHT], ['dark', DARK]] as const) {
      for (const [name, value] of tokens) {
        expect(value, `${name} in ${mode}`).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/)
      }
    }
  })

  it('bans pure black and pure white in dark mode', () => {
    // Maximum contrast is not maximum readability. It is eye strain over an
    // eight-hour day, which is how long this product stays open.
    expect(cssHex('dark', '--c-surface-page')).not.toBe('#000000')
    expect(cssHex('dark', '--c-text-primary')).not.toBe('#FFFFFF')
  })

  it('keeps the three ink levels distinct and correctly ordered', () => {
    for (const mode of MODES) {
      const surface = cssHex(mode, '--c-surface-raised')
      const primary = contrast(cssHex(mode, '--c-text-primary'), surface)
      const secondary = contrast(cssHex(mode, '--c-text-secondary'), surface)
      const muted = contrast(cssHex(mode, '--c-content-muted'), surface)

      // What you read, what you consult, what is not there yet.
      expect(primary, `${mode} primary`).toBeGreaterThan(secondary)
      expect(secondary, `${mode} secondary`).toBeGreaterThan(muted)

      // Body text is AA; a label is AA; a placeholder only has to be seen.
      expect(primary, `${mode} primary contrast`).toBeGreaterThanOrEqual(4.5)
      expect(secondary, `${mode} secondary contrast`).toBeGreaterThanOrEqual(4.5)
      expect(muted, `${mode} muted contrast`).toBeGreaterThanOrEqual(3)
    }
  })

  it('climbs elevation with lightness in dark mode', () => {
    // Shadow carries no information on a dark surface, so hierarchy has to be
    // lightness instead. Reusing the light shadows is the single most common
    // reason a dark theme reads as flat.
    const steps = ['--c-surface-page', '--c-surface-subtle', '--c-surface-raised', '--c-surface-overlay']
    const lightness = steps.map((token) => oklab(cssHex('dark', token)).L)
    for (let i = 1; i < lightness.length; i += 1) {
      expect(lightness[i]!, `${steps[i]} is not lighter than ${steps[i - 1]}`)
        .toBeGreaterThan(lightness[i - 1]!)
    }
  })
})

describe('chart palettes', () => {
  it('matches the validated hex values exactly', () => {
    // These are the values scripts/validate_palette.js passed. Editing one by
    // eye is how a palette silently stops being colourblind-safe, so the test
    // pins them and the only legitimate way to change one is to re-run the
    // validator and update both places.
    expect(CHART_CATEGORICAL.light).toEqual(
      ['#1E4E9D', '#C2417F', '#B27300', '#0097A7', '#7A5AF8', '#41752F'],
    )
    expect(CHART_CATEGORICAL.dark).toEqual(
      ['#4F86DB', '#D66594', '#B58012', '#17A0A0', '#B072E8', '#63A83C'],
    )
  })

  it('agrees with the stylesheet, slot for slot', () => {
    for (const mode of MODES) {
      CHART_CATEGORICAL[mode].forEach((hex, index) => {
        expect(cssHex(mode, `--c-chart-${index + 1}`), `${mode} slot ${index + 1}`)
          .toBe(hex.toUpperCase())
      })
      CHART_SEQUENTIAL[mode].forEach((hex, index) => {
        expect(cssHex(mode, `--c-chart-seq-${index + 1}`)).toBe(hex.toUpperCase())
      })
      CHART_DIVERGING[mode].forEach((hex, index) => {
        expect(cssHex(mode, `--c-chart-div-${index + 1}`)).toBe(hex.toUpperCase())
      })
    }
  })

  it('has exactly six categorical slots and names for all of them', () => {
    // A seventh series does not exist. It becomes "Other", small multiples, or
    // a different chart — generating an eighth hue is how a validated palette
    // stops being accessible.
    expect(CHART_CATEGORICAL.light).toHaveLength(6)
    expect(CHART_CATEGORICAL.dark).toHaveLength(6)
    expect(CHART_CATEGORICAL_NAMES).toHaveLength(6)
  })

  it('refuses a seventh series rather than cycling', () => {
    expect(() => seriesColour(6)).toThrow(RangeError)
    expect(() => seriesColour(-1)).toThrow(RangeError)
    expect(seriesColour(0, 'light')).toBe('#1E4E9D')
    expect(seriesColour(0, 'dark')).toBe('#4F86DB')
  })

  it('clears the normal-vision floor on the first three slots', () => {
    // Three is not a round number chosen for tidiness — it is the largest set
    // the validator passed under `--pairs all` in both themes, and slots 1–3
    // are one of the three passing sets. A chart of up to three series is
    // therefore readable by colour alone.
    for (const mode of MODES) {
      for (const [i, j] of pairs(CHART_SAFE_SLOTS)) {
        expect(deltaE(CHART_CATEGORICAL[mode][i]!, CHART_CATEGORICAL[mode][j]!),
          `${mode} safe slots ${i + 1}/${j + 1}`).toBeGreaterThanOrEqual(18)
      }
    }
  })

  it('keeps every remaining pair above the hard floor', () => {
    // Slots 4–6 exist and are usable, but only with the labels or texture that
    // `needsSecondaryEncoding` demands. 13 is the measured worst case (dark
    // navy against dark teal); anything below it and the extra slots would not
    // be worth having at all.
    for (const mode of MODES) {
      for (const [i, j] of pairs(6)) {
        expect(deltaE(CHART_CATEGORICAL[mode][i]!, CHART_CATEGORICAL[mode][j]!),
          `${mode} slots ${i + 1}/${j + 1}`).toBeGreaterThanOrEqual(13)
      }
    }
  })

  it('demands secondary encoding past the safe slot count', () => {
    expect(CHART_SAFE_SLOTS).toBe(3)
    expect(needsSecondaryEncoding(3)).toBe(false)
    expect(needsSecondaryEncoding(4)).toBe(true)
    expect(needsSecondaryEncoding(6)).toBe(true)
  })

  it('clears 3:1 against the surface it is drawn on', () => {
    for (const mode of MODES) {
      for (const hex of CHART_CATEGORICAL[mode]) {
        expect(contrast(hex, CHART_SURFACE[mode]), `${hex} on ${mode}`)
          .toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('validates against the surface actually in the stylesheet', () => {
    // The palettes were checked against a stated surface. If someone retunes
    // `--c-surface-raised` without re-running the validator, the recorded
    // result stops describing reality — so the stated surface is pinned to the
    // real one.
    for (const mode of MODES) {
      expect(cssHex(mode, '--c-surface-raised')).toBe(CHART_SURFACE[mode].toUpperCase())
    }
  })

  it('keeps the sequential ramp monotonic in lightness', () => {
    // Light: light to dark. Dark: dark to light. Either way the ramp must move
    // in one direction, or "more" stops meaning more somewhere in the middle
    // and the reader has no way to know where.
    for (const mode of MODES) {
      const L = CHART_SEQUENTIAL[mode].map((hex) => oklab(hex).L)
      const descending = L.every((value, i) => i === 0 || value < L[i - 1]!)
      const ascending = L.every((value, i) => i === 0 || value > L[i - 1]!)
      expect(descending || ascending, `${mode} sequential ramp is not monotonic`).toBe(true)
    }
    expect(oklab(CHART_SEQUENTIAL.light[0]!).L)
      .toBeGreaterThan(oklab(CHART_SEQUENTIAL.light[4]!).L)
    expect(oklab(CHART_SEQUENTIAL.dark[0]!).L)
      .toBeLessThan(oklab(CHART_SEQUENTIAL.dark[4]!).L)
  })

  it('keeps a neutral midpoint and opposed poles on the diverging ramp', () => {
    for (const mode of MODES) {
      const ramp = CHART_DIVERGING[mode].map(oklab)
      const mid = ramp[2]!

      // A hue at the middle invents a third category out of "no signal".
      expect(mid.C, `${mode} diverging midpoint is not neutral`).toBeLessThan(0.04)

      // The poles must sit on opposite sides of the hue circle, not merely be
      // different: two adjacent hues read as a sequence, not as a sign change.
      const warm = ramp[0]!
      const cool = ramp[4]!
      const dot = (warm.a * cool.a + warm.b * cool.b) / (warm.C * cool.C)
      expect(dot, `${mode} diverging poles are not opposed`).toBeLessThan(0)
    }
  })
})

describe('status', () => {
  it('agrees with the stylesheet in both themes', () => {
    for (const mode of MODES) {
      for (const [tone, hex] of Object.entries(STATUS_HEX[mode])) {
        expect(cssHex(mode, `--c-state-${tone}`), `${mode} ${tone}`).toBe(hex.toUpperCase())
      }
    }
  })

  it('keeps all four statuses apart, serious from critical included', () => {
    // The whole reason V2 has four statuses rather than three: an overdue task
    // and a failed migration must not look identical. They sit on one hue arc —
    // amber, orange, red — so they cannot be pushed as far apart as chart
    // series can. The floor is 8, the dataviz method's target for a pair that
    // ships with secondary encoding, and every status here ships with an icon
    // and a word. Below 8 the fourth status would be decorative.
    for (const mode of MODES) {
      const tones = Object.entries(STATUS_HEX[mode])
      for (const [i, j] of pairs(tones.length)) {
        expect(deltaE(tones[i]![1], tones[j]![1]),
          `${mode} ${tones[i]![0]} vs ${tones[j]![0]}`).toBeGreaterThanOrEqual(8)
      }
    }
  })

  it('reads against the surface it sits on', () => {
    for (const mode of MODES) {
      for (const [tone, hex] of Object.entries(STATUS_HEX[mode])) {
        expect(contrast(hex, cssHex(mode, '--c-surface-raised')), `${mode} ${tone}`)
          .toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('never reuses a status colour as a chart series', () => {
    // Reserved means reserved. A series that happens to be the danger red
    // makes every reader pause on a chart that is reporting nothing wrong.
    for (const mode of MODES) {
      const series = new Set(CHART_CATEGORICAL[mode].map((h) => h.toUpperCase()))
      for (const hex of Object.values(STATUS_HEX[mode])) {
        expect(series.has(hex.toUpperCase()), `${hex} is both a status and a series`).toBe(false)
      }
    }
  })

  it('orders severity so the worst of a set can be computed', () => {
    expect(worstTone(['good', 'warning'])).toBe('warning')
    expect(worstTone(['critical', 'good'])).toBe('critical')
    expect(worstTone(['serious', 'warning'])).toBe('serious')
    expect(worstTone([])).toBe('neutral')
    const ordered = [...STATUS_TONES].sort((a, b) => STATUS_SEVERITY[a] - STATUS_SEVERITY[b])
    expect(ordered).toEqual(['neutral', 'good', 'warning', 'serious', 'critical'])
  })
})

describe('enum presentation', () => {
  // Every one of these exists so no component ever writes
  // `value.replace('_', ' ').toLowerCase()`. That expression is a copy rule in
  // disguise, and it is wrong the first time a value is renamed.
  const cases: Array<[string, readonly string[], Record<string, unknown>]> = [
    ['watch status tone', WATCH_STATUSES, WATCH_STATUS_TONE_V2],
    ['deal stage tone', DEAL_STAGES, DEAL_STAGE_TONE],
    ['offer status tone', OFFER_STATUSES, OFFER_STATUS_TONE],
    ['request status tone', REQUEST_STATUSES, REQUEST_STATUS_TONE],
    ['task status tone', TASK_STATUSES, TASK_STATUS_TONE],
    ['priority tone', PRIORITIES, PRIORITY_TONE],
    ['customer status tone', CUSTOMER_STATUSES, CUSTOMER_STATUS_TONE],
    ['payment status tone', PAYMENT_STATUSES, PAYMENT_STATUS_TONE],
    ['task status label', TASK_STATUSES, TASK_STATUS_LABELS],
    ['activity direction label', ACTIVITY_DIRECTIONS, ACTIVITY_DIRECTION_LABELS],
    ['notification type label', NOTIFICATION_TYPES, NOTIFICATION_TYPE_LABELS],
  ]

  it.each(cases)('covers every %s', (_name, values, map) => {
    expect(Object.keys(map).sort()).toEqual([...values].sort())
  })

  it.each(cases)('uses only declared tones for %s', (name, _values, map) => {
    if (!name.endsWith('tone')) return
    for (const tone of Object.values(map)) {
      expect(STATUS_TONES).toContain(tone)
    }
  })

  it('writes labels as sentence case, not as shouted enum values', () => {
    const labels = [
      ...Object.values(TASK_STATUS_LABELS),
      ...Object.values(NOTIFICATION_TYPE_LABELS),
      ...Object.values(ACTIVITY_DIRECTION_LABELS),
    ]
    for (const label of labels) {
      expect(label).not.toMatch(/_/)
      expect(label).not.toBe(label.toUpperCase())
    }
  })
})

describe('size and motion', () => {
  it('offers three control heights and no more', () => {
    expect(Object.keys(CONTROL_HEIGHT)).toEqual(['sm', 'md', 'lg'])
    expect(CONTROL_HEIGHT.sm).toBeLessThan(CONTROL_HEIGHT.md)
    expect(CONTROL_HEIGHT.md).toBeLessThan(CONTROL_HEIGHT.lg)
    // `lg` is the touch size, which is why it exists at all.
    expect(CONTROL_HEIGHT.lg).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
  })

  it('mirrors the control scale into tailwind', () => {
    const config = readFileSync(resolve(__dirname, '../tailwind.config.ts'), 'utf8')
    for (const [name, px] of Object.entries(CONTROL_HEIGHT)) {
      expect(config, `control-${name}`).toContain(`'control-${name}': '${px}px'`)
    }
  })

  it('keeps every duration inside the 400ms ceiling', () => {
    // A 600ms transition is perceptible as waiting, and a user waiting on the
    // interface has stopped working.
    for (const [name, ms] of Object.entries(DURATION)) {
      expect(ms, name).toBeLessThanOrEqual(MAX_DURATION)
    }
    expect(DURATION.instant).toBe(0)
  })

  it('mirrors durations and easings into tailwind', () => {
    const config = readFileSync(resolve(__dirname, '../tailwind.config.ts'), 'utf8')
    for (const [name, ms] of Object.entries(DURATION)) {
      if (ms === 0) continue
      expect(config, `duration-${name}`).toContain(`${name}: '${ms}ms'`)
    }
    for (const [name, curve] of Object.entries(EASING)) {
      expect(config, `ease-${name}`).toContain(`${name}: '${curve}'`)
    }
  })

  it('compresses only the vertical axis under compact density', () => {
    expect(DENSITY_Y.COMFORTABLE).toBe(1)
    expect(DENSITY_Y.COMPACT).toBeLessThan(1)

    const css = CSS
    expect(css).toContain('--density-y: 1')
    expect(css).toContain(`--density-y: ${DENSITY_Y.COMPACT}`)

    // The horizontal steps must not consume the multiplier: the eye tracks
    // columns horizontally and rows vertically, so squeezing both makes a
    // table harder to read rather than denser.
    const config = readFileSync(resolve(__dirname, '../tailwind.config.ts'), 'utf8')
    const densityRefs = config.match(/var\(--density-y[^)]*\)/g) ?? []
    expect(densityRefs.length).toBeGreaterThan(0)
    for (const match of config.matchAll(/'(dy-\d)': 'calc\(/g)) {
      expect(match[1]).toMatch(/^dy-\d$/)
    }
  })

  it('lets opacity survive reduced motion while transforms do not', () => {
    const block = CSS.slice(CSS.indexOf('prefers-reduced-motion'))
    expect(block).toContain('transition-property: opacity')
    expect(block).not.toMatch(/transition-property:[^;]*transform/)
  })
})
