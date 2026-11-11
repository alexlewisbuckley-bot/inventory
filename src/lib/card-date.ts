/**
 * The year out of a guarantee card's date, however it is written.
 *
 * Only the year, deliberately. "06.04.2026" is the sixth of April or the
 * fourth of June depending on who filled the card in, and nothing here can
 * tell which — but both readings agree on 2026, and the year is the part a
 * stock record wants.
 *
 * And only the year: what is printed after DATE OF PURCHASE is when the
 * FIRST owner bought the watch from a retailer. On a second-hand piece that
 * is a different fact from when this shop bought it, so it must never reach
 * the purchase date, which the ageing report and every held-for figure are
 * worked out from.
 */
export function yearFromCard(raw: string | null): string {
  if (!raw) return ''
  const found = /(19|20)\d{2}/.exec(raw)
  if (!found) return ''
  const year = Number(found[0])
  return year <= new Date().getFullYear() + 1 ? String(year) : ''
}
