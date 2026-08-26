import type { ExtractedSupplier } from './invoice'

/**
 * Deciding whether the firm on this invoice is one already on the book.
 *
 * Getting this wrong is expensive in both directions. A false match posts a
 * purchase against the wrong company and quietly corrupts trading history; a
 * false miss creates "GB Luxury Ltd" beside "GB Luxury Limited" and splits
 * that history in two, which is how a supplier list becomes a supplier list
 * nobody trusts.
 *
 * So identifiers are tried before names. A VAT number or a company number is
 * the firm's actual identity — issued once, printed on every invoice, and
 * unambiguous — while a name is a thing typed differently by whoever made the
 * template. Names are only ever a fuzzy signal, and a fuzzy signal alone has
 * to clear a deliberately high bar.
 */

export type MatchKind = 'EXACT' | 'VAT_NO' | 'REGISTRATION' | 'EMAIL' | 'FUZZY' | 'CREATED'

export interface SupplierCandidate {
  id: string
  name: string
  legalName: string | null
  vatNo: string | null
  registrationNo: string | null
  email: string | null
  contactEmail: string | null
}

export interface SupplierResolution {
  candidate: SupplierCandidate | null
  kind: MatchKind
  /** 0–1. Only meaningful for FUZZY; identifier matches are certainties. */
  score: number
}

/**
 * Above this, two names are the same firm.
 *
 * Set high on purpose. "Watch Traders London" and "Watch Traders Manchester"
 * score around 0.8 on bigrams and are different companies; the cost of merging
 * them exceeds the cost of a duplicate somebody can merge later.
 */
export const FUZZY_THRESHOLD = 0.86

const LEGAL_SUFFIXES = /\b(limited|ltd|llp|llc|plc|inc|incorporated|corp|corporation|co|company|gmbh|ag|sa|sarl|bv|nv|pty|srl|spa|kg|oy|ab)\b\.?/g

/**
 * A trading name reduced to the part that identifies it.
 *
 * "GB Luxury Limited", "G.B. Luxury Ltd." and "gb luxury" are one firm written
 * three ways; every difference between them is punctuation, a legal suffix or
 * a capital letter.
 */
export function normaliseSupplierName(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.,''`"()]/g, '')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** VAT and company numbers compared as the digits and letters they are. */
export function normaliseIdentifier(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Sørensen–Dice on character bigrams.
 *
 * Chosen over edit distance because it is insensitive to word order — "Luxury
 * Watches GB" and "GB Luxury Watches" are obviously the same firm and are 12
 * edits apart — and because it needs no tuning per string length.
 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0

  const bigrams = (value: string): Map<string, number> => {
    const map = new Map<string, number>()
    for (let i = 0; i < value.length - 1; i += 1) {
      const pair = value.slice(i, i + 2)
      map.set(pair, (map.get(pair) ?? 0) + 1)
    }
    return map
  }

  const left = bigrams(a)
  const right = bigrams(b)
  let shared = 0
  for (const [pair, count] of left) {
    const other = right.get(pair)
    if (other) shared += Math.min(count, other)
  }
  return (2 * shared) / (a.length - 1 + b.length - 1)
}

const domainOf = (email: string | null | undefined): string => {
  const at = email?.indexOf('@') ?? -1
  if (!email || at < 0) return ''
  const domain = email.slice(at + 1).toLowerCase().trim()
  // A shared mailbox provider identifies a person, not a company: two dealers
  // both on gmail.com are not the same dealer.
  return /^(gmail|googlemail|hotmail|outlook|yahoo|icloud|live|aol|proton(mail)?)\./.test(domain) ? '' : domain
}

/**
 * The best match for this invoice's supplier, or nothing.
 *
 * Returns `CREATED` when nothing clears the bar — the caller then makes the
 * record, which is the whole point: an unknown supplier must not stop an
 * invoice being booked in.
 */
export function resolveSupplier(
  extracted: ExtractedSupplier,
  candidates: readonly SupplierCandidate[],
): SupplierResolution {
  const vatNo = normaliseIdentifier(extracted.vatNo)
  if (vatNo.length >= 7) {
    const hit = candidates.find((c) => normaliseIdentifier(c.vatNo) === vatNo)
    if (hit) return { candidate: hit, kind: 'VAT_NO', score: 1 }
  }

  const registrationNo = normaliseIdentifier(extracted.registrationNo)
  if (registrationNo.length >= 6) {
    const hit = candidates.find((c) => normaliseIdentifier(c.registrationNo) === registrationNo)
    if (hit) return { candidate: hit, kind: 'REGISTRATION', score: 1 }
  }

  // Both the trading name and the legal entity are tried, in both directions:
  // an invoice usually prints the legal name while the team files the firm
  // under what they call it.
  const names = [extracted.name, extracted.legalName]
    .map(normaliseSupplierName)
    .filter((name) => name.length > 1)

  if (names.length > 0) {
    for (const candidate of candidates) {
      const theirs = [candidate.name, candidate.legalName].map(normaliseSupplierName).filter(Boolean)
      if (theirs.some((their) => names.includes(their))) {
        return { candidate, kind: 'EXACT', score: 1 }
      }
    }
  }

  const domain = domainOf(extracted.email)
  if (domain) {
    const hit = candidates.find((c) => domainOf(c.email) === domain || domainOf(c.contactEmail) === domain)
    if (hit) return { candidate: hit, kind: 'EMAIL', score: 1 }
  }

  let best: SupplierResolution = { candidate: null, kind: 'CREATED', score: 0 }
  for (const candidate of candidates) {
    const theirs = [candidate.name, candidate.legalName].map(normaliseSupplierName).filter(Boolean)
    for (const mine of names) {
      for (const their of theirs) {
        const score = similarity(mine, their)
        if (score > best.score) {
          best = { candidate, kind: 'FUZZY', score }
        }
      }
    }
  }

  return best.score >= FUZZY_THRESHOLD && best.candidate
    ? best
    : { candidate: null, kind: 'CREATED', score: best.score }
}
