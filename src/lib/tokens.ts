/**
 * Design tokens, as values TypeScript can read.
 *
 * `globals.css` holds the same colours as CSS custom properties, which is
 * where every component gets them from. This file exists for the one case CSS
 * cannot serve: code that has to *compute* with a token — a chart assigning a
 * hue to the fifth series, a legend that must match a mark, an export to PNG
 * that has no stylesheet at all.
 *
 * The two are kept honest by `tests/tokens.test.ts`, which parses the CSS and
 * fails if a value here drifts from the variable it mirrors. Duplication that
 * a test guards is duplication; duplication nobody checks is a second design
 * system.
 *
 * Nothing here is a preference. Every chart colour below was produced by
 * `scripts/validate_palette.js` from the dataviz method and passes all five
 * checks against the surface it is used on — see `docs/design-system-v2.md`
 * §1.6.4 for the recorded output.
 */

import type {
  CustomerStatus, DealStage, OfferStatus, PaymentStatus, Priority,
  RequestStatus, TaskStatus, WatchStatus,
} from './enums'

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

export type ThemeMode = 'light' | 'dark'

// ---------------------------------------------------------------------------
// Chart colour
// ---------------------------------------------------------------------------

/**
 * Categorical: identity, not magnitude.
 *
 * Assigned in this fixed order and **never cycled**. Slot 1 is always the
 * first series, and a filter that removes series 2 must not repaint series 3 —
 * colour follows the entity, never its rank, or the chart tells a different
 * story after every click.
 *
 * There is no seventh slot. A seventh series becomes "Other", small multiples,
 * or a different chart; generating an eighth hue is precisely how a validated
 * palette stops being accessible.
 */
export const CHART_CATEGORICAL: Record<ThemeMode, readonly string[]> = {
  light: ['#1E4E9D', '#C2417F', '#B27300', '#0097A7', '#7A5AF8', '#41752F'],
  dark: ['#4F86DB', '#D66594', '#B58012', '#17A0A0', '#B072E8', '#63A83C'],
}

/** Human names for the slots, for a legend that has to explain itself. */
export const CHART_CATEGORICAL_NAMES = [
  'Navy', 'Magenta', 'Amber', 'Teal', 'Violet', 'Olive',
] as const

/**
 * How many series may be told apart by colour alone. Three.
 *
 * This number is measured, not chosen. Every 4-, 5- and 6-slot subset of the
 * palette above was run through `scripts/validate_palette.js --pairs all` in
 * both themes; none passed. Exactly three 3-slot subsets did, and slots 1–3
 * are one of them — which is why the order is navy, magenta, amber and not
 * something prettier.
 *
 * What defeats a fourth hue is protanopia, not taste: navy, teal and violet
 * collapse into one another (ΔE 2.7 at worst on the dark surface), and amber
 * and olive collapse into each other (ΔE 5.1 on the light one). No re-stepping
 * fixes that inside the lightness band — the band is only so wide, and six
 * distinguishable hues do not fit in it.
 *
 * So the rule, which components must honour: **a chart with four or more
 * series is not readable by colour alone and must carry direct labels,
 * texture, or small multiples.** A legend is present from two series upward
 * regardless. This is the condition on which the palette is accessible, not a
 * preference about chart style.
 */
export const CHART_SAFE_SLOTS = 3

/** True always: a legend appears from the second series onward. */
export const CHART_SECONDARY_ENCODING_REQUIRED = true

/** Does a chart of `n` series need labels or texture as well as a legend? */
export function needsSecondaryEncoding(seriesCount: number): boolean {
  return seriesCount > CHART_SAFE_SLOTS
}

/**
 * Sequential: magnitude. One hue, light to dark.
 *
 * Dark mode reverses the direction rather than the hue. On a light surface
 * "more" is darker; on a dark surface "more" is lighter. Reusing the light
 * order in dark makes the largest value the least visible one.
 */
export const CHART_SEQUENTIAL: Record<ThemeMode, readonly string[]> = {
  light: ['#E2EBF9', '#B8CCEC', '#6E93D6', '#2E63B0', '#012D68'],
  dark: ['#012D68', '#2E63B0', '#6E93D6', '#B8CCEC', '#E2EBF9'],
}

/**
 * Diverging: polarity. Two poles, a *neutral* midpoint.
 *
 * For anything signed — margin against target, variance, week-on-week change.
 * The midpoint is grey in both themes because a hue in the middle invents a
 * third category out of "no signal".
 */
export const CHART_DIVERGING: Record<ThemeMode, readonly string[]> = {
  light: ['#B42318', '#E88B84', '#E3EAF3', '#6FA8C9', '#12557E'],
  dark: ['#F97066', '#C55852', '#3E4650', '#4F92B8', '#8AC2E2'],
}

/** The surfaces the palettes above were validated against. */
export const CHART_SURFACE: Record<ThemeMode, string> = {
  light: '#FFFFFF',
  dark: '#11213A',
}

/**
 * The colour for series `index` (0-based), in `mode`.
 *
 * Throws past the sixth rather than wrapping. Wrapping is silent: the chart
 * still renders, two series share a colour, and nobody notices until somebody
 * reads it wrong.
 */
export function seriesColour(index: number, mode: ThemeMode = 'light'): string {
  const palette = CHART_CATEGORICAL[mode]
  if (!Number.isInteger(index) || index < 0 || index >= palette.length) {
    throw new RangeError(
      `Series ${index} has no colour. The palette has ${palette.length} slots and is never cycled — ` +
      'group the tail into "Other", or use small multiples.',
    )
  }
  return palette[index]!
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * The four reserved status colours, in order of escalation.
 *
 * Reserved means reserved: a status colour is never a series, never a brand
 * accent, never emphasis. `serious` is the one V2 adds — V1 had a single
 * danger colour, so an overdue task and a failed migration looked identical.
 * The distinction is *someone should act* against *something is broken*.
 */
export const STATUS_TONES = ['neutral', 'good', 'warning', 'serious', 'critical'] as const
export type StatusTone = (typeof STATUS_TONES)[number]

/** Ascending severity. `neutral` is absent: it is the lack of a status. */
export const STATUS_SEVERITY: Record<StatusTone, number> = {
  neutral: 0,
  good: 1,
  warning: 2,
  serious: 3,
  critical: 4,
}

/** The most severe of several tones — for a row summarising its children. */
export function worstTone(tones: readonly StatusTone[]): StatusTone {
  return tones.reduce<StatusTone>(
    (worst, tone) => (STATUS_SEVERITY[tone] > STATUS_SEVERITY[worst] ? tone : worst),
    'neutral',
  )
}

export const STATUS_HEX: Record<ThemeMode, Record<Exclude<StatusTone, 'neutral'>, string>> = {
  light: { good: '#00875A', warning: '#B26A00', serious: '#C2410C', critical: '#A31409' },
  dark: { good: '#3DD68C', warning: '#F5B841', serious: '#FB923C', critical: '#F97066' },
}

// ---------------------------------------------------------------------------
// Enum → tone
// ---------------------------------------------------------------------------
//
// Which colour a state wears is a design decision, so it lives here rather
// than beside the enum. The text label stays in `enums.ts`, beside the values
// it names. Both exist for the same reason: a component that writes
// `stage.replace('_', ' ').toLowerCase()` has invented a copy rule, and the
// day a stage is renamed is the day that copy is wrong in four places.
//
// Colour never carries status alone. Every one of these ships with an icon and
// a word (design-system-v2.md §1.6.3, §6).

export const WATCH_STATUS_TONE_V2: Record<WatchStatus, StatusTone> = {
  IN_STOCK: 'good',
  RESERVED: 'neutral',
  SALE_AGREED: 'warning',
  SOLD: 'neutral',
  RETURNED: 'warning',
  WRITTEN_OFF: 'critical',
}

export const DEAL_STAGE_TONE: Record<DealStage, StatusTone> = {
  ENQUIRY: 'neutral',
  QUALIFIED: 'neutral',
  SOURCING: 'neutral',
  OFFER_SENT: 'warning',
  NEGOTIATION: 'warning',
  DEPOSIT_TAKEN: 'good',
  PAYMENT_PENDING: 'warning',
  WON: 'good',
  LOST: 'critical',
}

export const OFFER_STATUS_TONE: Record<OfferStatus, StatusTone> = {
  SENT: 'neutral',
  ACCEPTED: 'good',
  DECLINED: 'serious',
  EXPIRED: 'serious',
  WITHDRAWN: 'neutral',
}

export const REQUEST_STATUS_TONE: Record<RequestStatus, StatusTone> = {
  OPEN: 'neutral',
  SOURCING: 'warning',
  MATCHED: 'good',
  FULFILLED: 'good',
  CANCELLED: 'neutral',
}

export const TASK_STATUS_TONE: Record<TaskStatus, StatusTone> = {
  OPEN: 'neutral',
  DONE: 'good',
  CANCELLED: 'neutral',
}

export const PRIORITY_TONE: Record<Priority, StatusTone> = {
  LOW: 'neutral',
  NORMAL: 'neutral',
  HIGH: 'warning',
  URGENT: 'serious',
}

export const CUSTOMER_STATUS_TONE: Record<CustomerStatus, StatusTone> = {
  ACTIVE: 'good',
  DORMANT: 'neutral',
  BLOCKED: 'critical',
}

/**
 * A payment state's tone.
 *
 * Overdue is `serious` and not `critical`: it means somebody should chase it,
 * which is a different instruction from "this failed". Refunded is neutral —
 * a refund is an outcome, not a fault, and colouring it red makes an honest
 * return look like an incident in every report it appears in.
 */
export const PAYMENT_STATUS_TONE: Record<PaymentStatus, StatusTone> = {
  PAID: 'good',
  DEPOSIT: 'warning',
  PENDING: 'warning',
  OVERDUE: 'serious',
  REFUNDED: 'neutral',
}

// ---------------------------------------------------------------------------
// Size and motion
// ---------------------------------------------------------------------------

/**
 * The three control heights, and the only three.
 *
 * `md` is the default. `sm` is for controls inside a dense row. `lg` exists
 * for the primary action on a form and for touch. A fourth height is how a
 * toolbar ends up looking assembled from parts.
 */
export const CONTROL_HEIGHT = { sm: 32, md: 40, lg: 44 } as const
export type ControlSize = keyof typeof CONTROL_HEIGHT

/** Minimum touch target, below which a control is not usable on a phone. */
export const MIN_TOUCH_TARGET = 44

export const DURATION = {
  instant: 0,
  fast: 120,
  base: 200,
  slow: 280,
  deliberate: 400,
} as const
export type DurationToken = keyof typeof DURATION

export const EASING = {
  standard: 'cubic-bezier(.2, 0, 0, 1)',
  emphasis: 'cubic-bezier(.4, 0, .2, 1)',
  exit: 'cubic-bezier(.4, 0, 1, 1)',
} as const

/** Nothing in the product may animate for longer than this. */
export const MAX_DURATION = 400

/** Vertical padding multiplier per density. Horizontal is never scaled. */
export const DENSITY_Y = { COMFORTABLE: 1, COMPACT: 0.75 } as const
