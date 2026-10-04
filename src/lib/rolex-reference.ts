/**
 * What a Rolex reference says about the metal.
 *
 * The last digit of a modern Rolex reference is the case material, and has
 * been for decades. 116500 is steel, 116503 is steel and yellow gold, 116506
 * is platinum, 116508 is yellow gold — one digit, the same meaning every time.
 *
 * This matters here because the material was the field the two systems
 * disagreed about most. Free text typed into an inventory record says
 * "Oystersteel and Everose gold" where a shop's list says "Two-tone Everose
 * Rolesor", and neither is wrong — they are two houses' words for one metal.
 * The reference settles it without either of them having to give way, because
 * Rolex already decided.
 *
 * Patek Philippe does the same with a letter — G for or gris, R for or rose —
 * and Audemars Piguet with a pair of them, ST, BA, OR. All three are read here.
 * Nobody else in the book is, and nor are the codes within a house that stand
 * for a combination nobody has pinned down: a scheme guessed at is a confident
 * answer with nothing behind it, and a watch listed in the wrong metal is
 * worse than one listed in none.
 */

/**
 * The digit, in the shop's own vocabulary.
 *
 * Named as Rolex names them, which is also how the storefront's own list is
 * written — "Two-tone Everose Rolesor" rather than "steel and pink gold".
 */
const BY_DIGIT: Record<string, string> = {
  0: 'Oystersteel',
  1: 'Two-tone Everose Rolesor',
  2: 'Rolesium',
  3: 'Two-tone Yellow Rolesor',
  4: 'Two-tone White Rolesor',
  5: '18k Everose Gold',
  6: '950 Platinum',
  // Retired by Rolex, and still on the wrist of anything old enough.
  7: '14k Yellow Gold',
  8: '18k Yellow Gold',
  9: '18k White Gold',
}

/**
 * The material digit of a reference, or null.
 *
 * Suffix letters are the dial or the bezel — CHNR, BLRO, RBR — and carry no
 * material of their own, so they come off before the digit is read. Anything
 * too short to be a reference is refused rather than guessed at: a two-digit
 * number read this way would answer confidently about nothing.
 */
export function materialFromReference(
  brandName: string | null | undefined,
  reference: string | null | undefined,
): string | null {
  if (!brandName || !reference) return null
  const brand = brandName.trim().toLowerCase()
  if (brand === 'rolex') return fromRolex(reference)
  // Patek and Vacheron use the same letter in the same place, which is less a
  // coincidence than two Geneva houses naming metals in the same French.
  if (brand === 'patek philippe' || brand === 'vacheron constantin') {
    return fromGenevaLetter(reference)
  }
  if (brand === 'audemars piguet') return fromAudemars(reference)
  return null
}

function fromRolex(reference: string): string | null {
  // Upper-cased with every separator removed, the way a reference is filed.
  const cleaned = reference.toUpperCase().replace(/[^A-Z0-9]/g, '')
  // The digits, with any trailing letters taken off the end.
  const digits = cleaned.replace(/[A-Z]+$/, '')
  if (!/^\d{4,}$/.test(digits)) return null

  return BY_DIGIT[digits[digits.length - 1]!] ?? null
}

/**
 * The Geneva letter, in French.
 *
 * Acier, or gris, or jaune, or rose, platine, titane — the first letter of the
 * metal as Geneva says it, which is why white gold is G and not W. Patek and
 * Vacheron Constantin both use it, in the same position.
 */
const BY_LETTER: Record<string, string> = {
  A: 'Stainless Steel',
  G: '18k White Gold',
  J: '18k Yellow Gold',
  R: '18k Rose Gold',
  P: '950 Platinum',
  T: 'Titanium',
}

function fromGenevaLetter(reference: string): string | null {
  // "5711/1A-010" and "4500V/110A-B128": whatever follows the hyphen is the
  // dial and the batch, not the case. The material letter is the last one
  // before it — the A, not the digits around it, and not the V that names
  // the Vacheron collection either, since it comes first.
  const main = reference.toUpperCase().split('-')[0] ?? ''
  const letters = main.replace(/[^A-Z]/g, '')
  if (!letters) return null

  const last = letters[letters.length - 1]!
  return BY_LETTER[last] ?? null
}

/**
 * Audemars Piguet's pair of letters.
 *
 * It sits straight after the model number — 26331ST.OO.1220ST.02 — so the
 * first segment is the one that describes the case; the later ones are the
 * bracelet and the dial.
 *
 * IO and IP are deliberately absent. They stand for combinations of titanium
 * with ceramic or platinum that are not written down consistently anywhere,
 * and a watch at this price listed in a metal somebody inferred is worse than
 * one listed in no metal at all. They come back as unmatched and get a name
 * from whoever is holding the watch.
 */
const BY_PAIR: Record<string, string> = {
  ST: 'Stainless Steel',
  OR: '18k Rose Gold',
  BA: '18k Yellow Gold',
  BC: '18k White Gold',
  PT: '950 Platinum',
  SA: 'Stainless Steel and Yellow Gold',
  SN: 'Stainless Steel and Rose Gold',
  TI: 'Titanium',
  CE: 'Ceramic',
}

function fromAudemars(reference: string): string | null {
  // The case code is in the first segment. What follows describes the
  // bracelet and the dial, and often repeats a metal that is not the case's.
  const first = reference.toUpperCase().split('.')[0] ?? ''
  const letters = first.replace(/[^A-Z]/g, '')
  if (letters.length < 2) return null

  return BY_PAIR[letters.slice(-2)] ?? null
}
