/**
 * What a partner pays, worked out rather than stored.
 *
 * A corporate partner buys at an agreed percentage off the asking price. The
 * rate lives on the partner and the price is derived at the moment it is
 * read, so repricing a watch moves every partner's price with it. The
 * alternative — a partner price column, or a price list per partner — is a
 * second copy of the truth that goes stale the first time somebody adjusts a
 * watch and forgets the lists hanging off it.
 */

/**
 * Basis points, not a percentage and certainly not a float.
 *
 * 8% is 800. Hundredths of a percent are finer than anybody negotiates and
 * integer arithmetic has no rounding of its own, which matters because this
 * number multiplies every price a partner is ever quoted.
 */
export const RATE_PRECISION = 10_000

/**
 * The most anybody may be given, as a guard against a typo rather than a
 * commercial rule.
 *
 * A corporate rate is single digits to the mid teens. Half off is already
 * implausible, and the failure this stops is somebody typing 80 meaning 8 —
 * which would otherwise quote the next order at a fifth of its price and look
 * entirely deliberate.
 */
export const MAX_DISCOUNT_BPS = 5_000

/** Whether a stored rate is one this system will quote from. */
export function isUsableRate(bps: number): boolean {
  return Number.isInteger(bps) && bps >= 0 && bps <= MAX_DISCOUNT_BPS
}

/**
 * What a partner pays for a watch, in base minor units.
 *
 * Null where there is no asking price. A watch nobody has priced cannot be
 * discounted into one — quoting a partner off a blank is how a piece leaves
 * at a number nobody chose, and the portal should simply not offer it.
 *
 * `tradePriceGbp` is a floor the rate may not go through. Alex: "Can we
 * ensure this discount never ever goes past trade price." A partner is a
 * retail buyer with terms, not a dealer; selling one a watch for less than
 * another dealer would be quoted inverts the whole price list, and it happens
 * silently — a rate agreed when a piece was priced at one number keeps
 * applying after somebody marks it down, and the day it crosses the trade
 * price nothing announces it.
 *
 * Where there is no trade price there is no floor, because there is nothing to
 * measure against. Inventing one — from cost, say — would be a number nobody
 * agreed to, quietly applied to what a partner pays.
 */
export function partnerPrice(
  estSaleGbp: number | null | undefined,
  bps: number,
  tradePriceGbp?: number | null,
): number | null {
  if (estSaleGbp === null || estSaleGbp === undefined) return null
  if (!isUsableRate(bps)) return estSaleGbp
  // Rounded rather than floored: a floor would quietly give away a minor unit
  // on every line, and the difference belongs to arithmetic rather than to a
  // policy nobody wrote down.
  const discounted = Math.round((estSaleGbp * (RATE_PRECISION - bps)) / RATE_PRECISION)

  if (tradePriceGbp === null || tradePriceGbp === undefined) return discounted
  /*
   * And never above the asking price on the way back up.
   *
   * A trade price higher than retail is a data error rather than an
   * arrangement, and clamping blindly to the floor would quote a partner MORE
   * than a member of the public walking in — which is the same failure in the
   * opposite direction and reads just as deliberate.
   */
  return Math.min(Math.max(discounted, tradePriceGbp), estSaleGbp)
}

/** Whether the trade floor, rather than the rate, decided this price. */
export function isFloored(
  estSaleGbp: number | null | undefined,
  bps: number,
  tradePriceGbp?: number | null,
): boolean {
  if (estSaleGbp === null || estSaleGbp === undefined) return false
  if (tradePriceGbp === null || tradePriceGbp === undefined) return false
  if (!isUsableRate(bps)) return false
  const discounted = Math.round((estSaleGbp * (RATE_PRECISION - bps)) / RATE_PRECISION)
  return discounted < tradePriceGbp && tradePriceGbp <= estSaleGbp
}

/** What the partner saves against the asking price, in base minor units. */
export function partnerSaving(
  estSaleGbp: number | null | undefined,
  bps: number,
  tradePriceGbp?: number | null,
): number | null {
  const price = partnerPrice(estSaleGbp, bps, tradePriceGbp)
  if (price === null || estSaleGbp === null || estSaleGbp === undefined) return null
  return estSaleGbp - price
}

/**
 * A rate as somebody types it, turned into basis points.
 *
 * People negotiate in percent and say "eight and a half", so the form takes a
 * percentage and this is the one place it becomes the integer everything else
 * uses. Null for anything that is not a rate, which the caller reports rather
 * than rounding into something plausible.
 */
export function bpsFromPercent(raw: string): number | null {
  const text = raw.trim().replace(/%$/, '').trim()
  if (text === '') return null
  const percent = Number(text)
  if (!Number.isFinite(percent)) return null
  const bps = Math.round(percent * 100)
  return isUsableRate(bps) ? bps : null
}

/** Basis points as a percentage somebody would say out loud: 850 → "8.5%". */
export function percentFromBps(bps: number): string {
  const percent = bps / 100
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0$/, '')}%`
}
