/**
 * What a reading costs, in money rather than tokens.
 *
 * Alex: "5 cent per watch is fine but ... how do i ... check and manage the
 * costs."
 *
 * Tokens are not an answer to that question. Every call already comes back
 * with its token counts; this is the table that turns them into a number
 * somebody can hold against a watch's margin, and the reason the figure is
 * worked out at the moment of the call rather than at the moment of the
 * report: prices change, and a bill from March should still read as March's
 * bill in June.
 */

/** United States dollars per million tokens, as published. */
export interface ModelPrice {
  input: number
  output: number
}

/**
 * The models this application actually calls.
 *
 * Deliberately not a copy of the whole price list. An entry here is a model
 * some service names, and a service naming a model that is missing from this
 * table is a thing worth noticing rather than quietly costing nothing — see
 * `costMicros`.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
}

/** Millionths of a dollar. A reading of two photographs is around 40,000. */
export type Micros = number

/**
 * What one call cost, in millionths of a dollar.
 *
 * Integer micros rather than a float of dollars, for the reason every other
 * amount in this system is minor units: a column of floating-point pennies
 * does not add up to what anybody expects.
 *
 * An unpriced model returns null rather than zero. Zero would quietly report
 * a month of spending as free, which is the one wrong answer that nobody
 * goes looking for.
 */
export function costMicros(
  model: string,
  inputTokens: number,
  outputTokens: number,
): Micros | null {
  const price = MODEL_PRICES[model]
  if (!price) return null
  const dollars = (inputTokens * price.input + outputTokens * price.output) / 1_000_000
  return Math.round(dollars * 1_000_000)
}

/** Micros as somebody would say it: "4.1 cents", "$12.40". */
export function formatMicros(micros: Micros): string {
  const dollars = micros / 1_000_000
  if (dollars === 0) return '$0.00'
  // Under a dollar reads better in cents, which is the unit these land in.
  if (dollars < 1) {
    const cents = dollars * 100
    return `${cents < 1 ? cents.toFixed(2) : cents.toFixed(1)}¢`
  }
  return `$${dollars.toFixed(2)}`
}
