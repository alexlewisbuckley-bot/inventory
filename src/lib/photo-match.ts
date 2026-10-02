/**
 * Matching a photograph to the watch it belongs to, by its filename.
 *
 * A warranty card is provenance. Attaching one to the wrong watch is not an
 * untidy gallery, it is a document asserting that this watch has a history it
 * does not have — so everything here is built to refuse rather than to guess.
 * A proposal is only ever a proposal: the caller shows it to somebody before
 * anything is written.
 *
 * The rules, in order:
 *
 *   1. A serial found anywhere in the filename wins. Serials are long and
 *      distinctive, and phones name files `IMG_4821`, so the serial is
 *      usually appended rather than used alone.
 *   2. Otherwise a stock number, but only when it stands apart from the
 *      digits around it — `IMG_1378.jpg` means the stock number, `IMG_20260213.jpg`
 *      does not, and the difference matters when every phone photograph is a
 *      long run of digits.
 *   3. Anything ambiguous matches nothing. Two watches sharing a serial, or a
 *      filename naming two different watches, is a question for a person.
 */

export interface MatchCandidate {
  id: string
  /** Numeric in the database, written as text in a filename. Both accepted. */
  stockNo: string | number
  serial: string | null
}

export type MatchReason = 'serial' | 'stock number'

export interface PhotoMatch {
  file: string
  watchId: string | null
  reason: MatchReason | null
  /** Why nothing was proposed, in words a person can act on. */
  note: string | null
}

/**
 * A serial shorter than this is not used for matching.
 *
 * Short serials appear by coincidence inside dates, phone counters and
 * reference numbers. Rolex serials are eight characters; anything much
 * shorter in the data is likely a partial record, and a partial record is not
 * worth a wrong attachment.
 */
const MIN_SERIAL_LENGTH = 5

/** Upper-cased, with every separator removed, so `466787-F0` finds `466787F0`. */
function flatten(value: string | number): string {
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function withoutExtension(file: string): string {
  const cut = file.lastIndexOf('.')
  return cut > 0 ? file.slice(0, cut) : file
}

/**
 * Does this stock number stand on its own in the filename?
 *
 * `1378` inside `IMG_20260213` is a coincidence; inside `IMG_1378` it is the
 * stock number. The test is the characters either side: a digit next to it
 * means it is part of a longer number, so it does not count.
 */
function standsAlone(haystack: string, needle: string): boolean {
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return false
    const before = at === 0 ? '' : haystack[at - 1]!
    const after = haystack[at + needle.length] ?? ''
    if (!/\d/.test(before) && !/\d/.test(after)) return true
    from = at + 1
  }
}

/** Propose a watch for one filename, or explain why it could not. */
export function matchPhoto(file: string, candidates: readonly MatchCandidate[]): PhotoMatch {
  const flat = flatten(withoutExtension(file))
  if (!flat) return { file, watchId: null, reason: null, note: 'The filename has nothing to match on.' }

  // --- 1. Serial -----------------------------------------------------------
  const bySerial = candidates.filter((c) => {
    const serial = c.serial ? flatten(c.serial) : ''
    return serial.length >= MIN_SERIAL_LENGTH && flat.includes(serial)
  })
  if (bySerial.length === 1) {
    return { file, watchId: bySerial[0]!.id, reason: 'serial', note: null }
  }
  if (bySerial.length > 1) {
    return {
      file, watchId: null, reason: null,
      note: `That serial is on ${bySerial.length} watches (${bySerial.map((c) => c.stockNo).join(', ')}). Choose one.`,
    }
  }

  // --- 2. Stock number -----------------------------------------------------
  const byStock = candidates.filter((c) => standsAlone(flat, flatten(c.stockNo)))
  if (byStock.length === 1) {
    return { file, watchId: byStock[0]!.id, reason: 'stock number', note: null }
  }
  if (byStock.length > 1) {
    return {
      file, watchId: null, reason: null,
      note: `The filename could mean stock ${byStock.map((c) => c.stockNo).join(' or ')}. Choose one.`,
    }
  }

  return { file, watchId: null, reason: null, note: 'No serial or stock number in the filename.' }
}

/**
 * Match a batch, and refuse to put two photographs on the same watch by
 * accident.
 *
 * Several cards legitimately belong to one watch — front and back — so this
 * does not forbid it. It is the caller's grid that shows the duplication,
 * which is the only place a person can tell "front and back" from "I have
 * named two different cards after the same serial".
 */
export function matchPhotos(files: readonly string[], candidates: readonly MatchCandidate[]): PhotoMatch[] {
  return files.map((file) => matchPhoto(file, candidates))
}
