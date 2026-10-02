/**
 * Matching a photograph to the watch it belongs to, by its filename.
 *
 * A photograph on the wrong watch is a listing showing a buyer something
 * they are not being sold, and on a warranty card it is a document asserting
 * a history that watch does not have. So everything here is built to refuse
 * rather than to guess, and a proposal is only ever a proposal: the caller
 * shows it to somebody before anything is written.
 *
 * Three keys, in order of how much they pin a watch down:
 *
 *   1. The serial, which identifies exactly one watch, found anywhere in the
 *      name — phones produce `IMG_4821`, so a serial is usually appended
 *      rather than used alone, and it may be written with separators.
 *   2. The reference. This is what people actually name files after, because
 *      it is what is written on the watch and on the bag it came in. It is
 *      usually but not always unique: several of one reference in stock is
 *      ordinary, and then this narrows rather than decides.
 *   3. The stock number.
 *
 * Reference and stock number are matched as whole words rather than as
 * substrings. `1378` inside `IMG_20261378045` is a coincidence, and every
 * photograph off a phone is a long run of digits, so substring matching on a
 * short number attaches pictures to watches at random. The serial is long
 * and distinctive enough to be safe as a substring, which is what lets a
 * hyphenated one still be found.
 */

export interface MatchCandidate {
  id: string
  /** Numeric in the database, written as text in a filename. Both accepted. */
  stockNo: string | number
  /** The reference — `126711CHNR`, `5167R`. Stored as the watch's model. */
  reference: string
  serial: string | null
  /**
   * What the watch is called in words — `Rolex Lady-Datejust`, `Audemars
   * Piguet Royal Oak Concept`.
   *
   * Ranking only, never matching. Files do arrive called `Day-Date
   * Masterpiece.png`, so a name has to count for something; but a brand is on
   * forty watches at once, so it can never decide one.
   */
  name?: string | null
}

export type MatchReason = 'serial' | 'reference' | 'stock number' | 'closest reference'

export interface PhotoMatch {
  file: string
  /** Set only when exactly one watch answers. */
  watchId: string | null
  reason: MatchReason | null
  /**
   * Whether the filename actually said this watch, or merely came close.
   *
   * A near match is still proposed — a reference typed one character out is
   * far more useful found than not — but it is never quietly treated as
   * fact. The caller marks these for a second look.
   */
  exact: boolean
  /** Why it decided what it did, in words somebody can act on. */
  note: string | null
  /**
   * The watches it was choosing between.
   *
   * Populated when the filename named something real but more than one watch
   * answered to it. The caller narrows its picker to these, which turns
   * "find it among forty" into "pick one of three".
   */
  candidates: string[]
}

/**
 * A serial shorter than this is not used.
 *
 * Short ones appear by coincidence inside dates, phone counters and
 * references. Rolex serials are eight characters; anything much shorter in
 * the data is a partial record, and a partial record is not worth a wrong
 * attachment.
 */
const MIN_SERIAL_LENGTH = 5

/** Upper-cased with every separator removed, so `466787-F0` finds `466787F0`. */
function flatten(value: string | number): string {
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** The filename split into whole words: `IMG_5167R-front` → IMG, 5167R, FRONT. */
function tokens(file: string): Set<string> {
  const cut = file.lastIndexOf('.')
  const stem = cut > 0 ? file.slice(0, cut) : file
  return new Set(stem.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean))
}

/**
 * The shortest word in a reference that is long enough to be the reference.
 *
 * Four, because references go down to five characters and a typed one can be
 * a character out, while three-character words in this field are `II`, `GMT`
 * and `LTD` — present on half the stock and therefore worth nothing.
 */
const MIN_REFERENCE_WORD = 4

/**
 * Every way one reference could legitimately be written in a filename.
 *
 * The field is free text and is not always only the reference: real records
 * read `Explorer II 343591`, where the part anyone would name a file after is
 * one word inside it. So the whole thing counts, and so does each word of it
 * long enough to stand alone.
 */
function referenceKeys(reference: string): string[] {
  const whole = flatten(reference)
  if (!whole) return []
  const keys = new Set<string>([whole])
  for (const word of tokens(reference)) {
    if (word.length >= MIN_REFERENCE_WORD) keys.add(word)
  }
  return [...keys]
}

function decide(
  file: string,
  reason: MatchReason,
  found: readonly MatchCandidate[],
  describe: (found: readonly MatchCandidate[]) => string,
): PhotoMatch | null {
  if (found.length === 0) return null
  if (found.length === 1) {
    return {
      file, watchId: found[0]!.id, reason, exact: true,
      note: `Matched on ${reason}`, candidates: [found[0]!.id],
    }
  }
  return { file, watchId: null, reason: null, exact: false, note: describe(found), candidates: found.map((c) => c.id) }
}

/** Propose a watch for one filename, or explain why it could not. */
export function matchPhoto(file: string, candidates: readonly MatchCandidate[]): PhotoMatch {
  const flat = flatten(file.replace(/\.[^.]+$/, ''))
  const words = tokens(file)
  if (!flat) {
    return {
      file, watchId: null, reason: null, exact: false, candidates: [],
      note: 'The filename has nothing to match on.',
    }
  }

  const bySerial = candidates.filter((c) => {
    const serial = c.serial ? flatten(c.serial) : ''
    return serial.length >= MIN_SERIAL_LENGTH && flat.includes(serial)
  })
  const serialMatch = decide(file, 'serial', bySerial, (found) =>
    `That serial is on ${found.length} watches (${found.map((c) => c.stockNo).join(', ')}). Choose one.`)
  if (serialMatch) return serialMatch

  const byReference = candidates.filter((c) => referenceKeys(c.reference).some((key) => words.has(key)))
  const referenceMatch = decide(file, 'reference', byReference, (found) =>
    `${found.length} watches answer to that reference (${found.map((c) => c.stockNo).join(', ')}). Choose one.`)
  if (referenceMatch) return referenceMatch

  const byStock = candidates.filter((c) => words.has(flatten(c.stockNo)))
  const stockMatch = decide(file, 'stock number', byStock, (found) =>
    `The filename could mean stock ${found.map((c) => c.stockNo).join(' or ')}. Choose one.`)
  if (stockMatch) return stockMatch

  // Nothing matched outright. Rather than give up, offer the nearest
  // reference — a filename a character out from the real thing is far more
  // useful found than not — and say plainly that it is a guess.
  const near = nearestReference(words, candidates)
  if (near) {
    return {
      file, watchId: near.candidate.id, reason: 'closest reference', exact: false,
      note: `Closest match to "${near.token}" — check this`,
      candidates: [near.candidate.id],
    }
  }

  return {
    file, watchId: null, reason: null, exact: false, candidates: [],
    note: 'No serial, reference or stock number in the filename.',
  }
}

/** Edit distance, capped: anything past the cap is simply "too far". */
function distance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + cost)
      row.push(value)
      if (value < best) best = value
    }
    if (best > cap) return cap + 1
    previous = row
  }
  return previous[b.length]!
}

/**
 * The nearest reference to any word in the filename, when one is close enough
 * to be worth offering.
 *
 * How close is "close enough" scales with length, because one wrong character
 * in a five-character reference is a fifth of it and could as easily be a
 * different watch, while two in a ten-character one is plainly a typo. A tie
 * is no answer at all: if two references are equally near, neither is
 * offered.
 */
function nearestReference(
  words: Set<string>,
  candidates: readonly MatchCandidate[],
): { candidate: MatchCandidate; token: string } | null {
  let best: { candidate: MatchCandidate; token: string; score: number } | null = null
  let tied = false

  for (const token of words) {
    // Words too short to be a reference, or obvious camera noise, are skipped.
    if (token.length < MIN_REFERENCE_WORD || token === 'IMG' || token === 'PHOTO') continue
    // A near match is only ever offered for a word with a letter in it, and
    // this is the rule that earns its keep. References here are six digits —
    // 116233, 179383 — and so is the time in every filename a phone
    // produces: `IMG_20260213_112233` is one character from 116233. There is
    // no way to tell that apart from a typed reference, so a run of digits is
    // matched exactly or not at all. The cost is a mistyped numeric reference
    // going unfound; the alternative is attaching photographs to watches
    // because of what time they were taken.
    if (!/[A-Z]/.test(token)) continue
    for (const candidate of candidates) {
      for (const reference of referenceKeys(candidate.reference)) {
        const cap = Math.max(1, Math.floor(Math.max(reference.length, token.length) / 3))
        const score = distance(token, reference, cap)
        if (score > cap || score === 0) continue
        if (!best || score < best.score) { best = { candidate, token, score }; tied = false }
        else if (score === best.score && candidate.id !== best.candidate.id) tied = true
      }
    }
  }
  if (!best || tied) return null
  return { candidate: best.candidate, token: best.token }
}

/** Match a batch, keeping the order it was given. */
export function matchPhotos(files: readonly string[], candidates: readonly MatchCandidate[]): PhotoMatch[] {
  return files.map((file) => matchPhoto(file, candidates))
}

/**
 * What kind of image a filename is announcing itself to be.
 *
 * A guess, and a weak one, but the alternative is making somebody set the
 * same value seventy-three times. Anything that does not say otherwise is
 * taken to be a photograph of the watch, which is what most of them are.
 */
export function guessKind(file: string): 'WATCH' | 'CARD' | 'DOCUMENT' {
  // Whole words, not substrings: `IMG_01_card` has no word boundary before
  // `card` as a regular expression counts one, because an underscore is a
  // word character — and an underscore is how most cameras separate things.
  const words = tokens(file)
  for (const word of words) {
    if (/^(card|warranty|guarantee|cert)/.test(word.toLowerCase())) return 'CARD'
  }
  for (const word of words) {
    if (/^(doc|invoice|receipt|service|papers)/.test(word.toLowerCase())) return 'DOCUMENT'
  }
  return 'WATCH'
}

/* ------------------------------------------------------------------ *
 * Ranking: what to offer when nothing matched.
 *
 * Refusing to guess is right, and on its own it is useless. A row that says
 * "no match" and then hands over forty watches in stock-number order has
 * moved the work rather than done it — the person still has to know which
 * watch `336938.png` is, and the one piece of evidence they have, the
 * filename, has been thrown away.
 *
 * So the filename is also used for a shortlist: not to decide, but to put the
 * likely answers first. Nothing here is ever acted on automatically.
 * ------------------------------------------------------------------ */

/** Words in a filename that describe the photograph, not the watch. */
const NOISE = new Set([
  'IMG', 'IMAGE', 'PHOTO', 'PIC', 'PICTURE', 'DSC', 'DSCN', 'PXL', 'MVIMG',
  'SCREENSHOT', 'SCAN', 'WHATSAPP', 'COPY', 'FINAL', 'EDIT', 'NEW',
  'FRONT', 'BACK', 'SIDE', 'DIAL', 'CASE', 'CLASP', 'WRIST',
  'CARD', 'WARRANTY', 'GUARANTEE', 'CERT', 'CERTIFICATE',
  'DOC', 'DOCS', 'INVOICE', 'RECEIPT', 'SERVICE', 'PAPERS',
  'JPG', 'JPEG', 'PNG', 'WEBP', 'HEIC', 'AT', 'AND', 'THE', 'OF',
])

function isNoise(word: string): boolean {
  if (NOISE.has(word)) return true
  // A year, which every camera and messaging app puts in a filename.
  return /^(19|20)\d{2}$/.test(word)
}

/** How many characters two words open with in common. */
function commonPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1
  return i
}

/**
 * How much one word in a filename looks like one way of naming a watch.
 *
 * Deliberately generous where guessing is free. The prefix term is what makes
 * this useful on real references: `336938` and `336934` are the same watch in
 * two metals, and somebody looking for the first will accept being shown the
 * second — which is exactly the offer a shortlist is making.
 */
function affinity(token: string, key: string): number {
  if (token.length < 3 || key.length < 3) return 0
  if (token === key) return 100
  const prefix = commonPrefix(token, key)
  if (key.startsWith(token) || token.startsWith(key)) return 70 + Math.min(prefix, 12)
  if (key.includes(token) || token.includes(key)) return 55
  const gap = distance(token, key, 4)
  if (gap <= 4) return Math.max(0, 50 - gap * 9 + prefix * 2)
  return prefix >= 3 ? 10 + prefix * 3 : 0
}

/** Every way of naming one watch that somebody might have typed. */
function searchKeys(candidate: MatchCandidate): string[] {
  const keys = new Set<string>(referenceKeys(candidate.reference))
  keys.add(flatten(candidate.stockNo))
  if (candidate.serial) keys.add(flatten(candidate.serial))
  for (const word of tokens(candidate.name ?? '')) {
    if (word.length >= 3) keys.add(word)
  }
  return [...keys].filter(Boolean)
}

/**
 * Below this a candidate is not worth offering. A shortlist of things that
 * merely share a digit is a longer list, not a shorter one.
 */
const WORTH_OFFERING = 30

export interface RankedCandidate<C extends MatchCandidate> {
  candidate: C
  score: number
}

/**
 * The watches a piece of text most looks like it is talking about.
 *
 * Used twice: on a filename, to put a shortlist above the full list for a
 * photograph nothing matched; and on whatever somebody types into the picker,
 * so that searching finds a watch by reference, name, stock number or serial
 * without caring which of those was typed.
 */
export function rankCandidates<C extends MatchCandidate>(
  text: string,
  candidates: readonly C[],
  limit = 6,
): RankedCandidate<C>[] {
  const words = [...tokens(text)].filter((word) => !isNoise(word))
  if (!words.length) return []

  const ranked: RankedCandidate<C>[] = []
  for (const candidate of candidates) {
    const keys = searchKeys(candidate)
    // The best a word does against any way of naming this watch.
    const perWord = words
      .map((word) => Math.max(0, ...keys.map((key) => affinity(word, key))))
      .sort((a, b) => b - a)
    if (!perWord.length || perWord[0]! < WORTH_OFFERING) continue
    // Two words agreeing beats one word agreeing, which is what makes
    // `Day-Date Masterpiece` land on the Day-Date Masterpiece.
    const score = perWord[0]! + (perWord[1] ?? 0)
    ranked.push({ candidate, score })
  }

  return ranked.sort((a, b) => b.score - a.score || String(a.candidate.stockNo).localeCompare(String(b.candidate.stockNo)))
    .slice(0, limit)
}
