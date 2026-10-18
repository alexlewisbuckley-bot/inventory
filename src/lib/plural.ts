/**
 * One noun, in the right number.
 *
 * Every count in this application was built by adding an "s", which is right
 * for a sale and a customer and wrong for the one noun the system is actually
 * about: the stock list read "Showing 1–2 of 2 watchs". The audit trail had
 * "entrys" for the same reason.
 *
 * Deliberately small. This is not a general English pluraliser and should not
 * grow into one — it covers the shapes this application's nouns actually take,
 * and anything irregular is listed by name rather than guessed at. A rule that
 * is wrong in a way nobody has noticed is worse than a short list that is
 * obviously incomplete.
 */

/**
 * Words the rules below would get wrong, spelled out.
 *
 * Only ones this application uses. "Person" is here because `persons` is what
 * the rules would produce and what no one says.
 */
const IRREGULAR: Record<string, string> = {
  person: 'people',
  man: 'men',
  woman: 'women',
}

/** The plural of a noun, whatever the count. */
export function pluralOf(noun: string): string {
  const key = noun.toLowerCase()
  const irregular = IRREGULAR[key]
  // Matched case-insensitively and given back in the shape it arrived in, so
  // a label written "Person" does not come back as "people".
  if (irregular) {
    return noun[0] === noun[0]?.toUpperCase()
      ? irregular[0]!.toUpperCase() + irregular.slice(1)
      : irregular
  }
  // A consonant before the y: entry -> entries, company -> companies. A vowel
  // before it keeps the y, which is why this tests the letter in front rather
  // than the ending alone — day -> days, not daies.
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`
  // A sibilant needs the extra syllable to be sayable: watch -> watches,
  // box -> boxes, glass -> glasses, waltz -> waltzes.
  //
  // Short words ending in a single z double it — quiz is quizzes — and this
  // does not know that. No noun in this application ends in z at all, so the
  // rule is left simple rather than carrying a case nothing reaches; add the
  // word to IRREGULAR above if one ever turns up.
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`
  return `${noun}s`
}

/**
 * The noun as a count of that many: `plural('watch', 2)` is "watches".
 *
 * The number is not included. Callers put it in themselves because they format
 * it differently — some want a thousands separator, some are writing "No
 * watches" where there is no number at all.
 */
export function plural(noun: string, count: number): string {
  return count === 1 ? noun : pluralOf(noun)
}
