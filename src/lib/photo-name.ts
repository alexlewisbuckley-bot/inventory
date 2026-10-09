/**
 * What a photograph is called when it leaves the building.
 *
 * Off a phone they are IMG_2841, IMG_2842, IMG_2843 — eighty in a row that
 * say nothing about which watch is in them. Inside the system that does not
 * matter, because a photograph is attached to its watch. It matters the
 * moment one is downloaded: on a desktop, in an email, on a dealer's drive,
 * the filename is the only thing left of the connection.
 *
 * The serial is the name to use. It is the one identifier that means the same
 * thing to everybody — a stock number is this house's word for the piece, a
 * reference is the model rather than the watch, and only the serial names the
 * individual object in the photograph.
 */

/** Extensions for the three formats the uploader accepts. */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * The stem of the name: the serial, or the stock number when there is none.
 *
 * A watch booked in before its serial was read still has photographs, and
 * they still have to be called something. "stock-1143" is obviously a
 * stand-in, which is the point — it does not look like a serial, so nobody
 * files it as one.
 *
 * Anything that is not a letter or a digit comes out. Serials are stamped
 * alphanumerics, but they get typed with spaces and the occasional stray
 * punctuation mark, and a filename carrying a slash is a filename that
 * becomes a directory on the way out.
 */
export function photographStem(serial: string | null | undefined, stockNo: number): string {
  const cleaned = (serial ?? '').replace(/[^A-Za-z0-9]+/g, '')
  return cleaned.length > 0 ? cleaned.toUpperCase() : `stock-${stockNo}`
}

/**
 * The full filename for one photograph of a watch.
 *
 * Numbered only where a watch has more than one, so the common case — one
 * photograph, one serial — produces exactly the serial and nothing else.
 * Numbering from the second rather than the first: 0SQ84951.jpg and
 * 0SQ84951-2.jpg read as a piece and its second angle, where 0SQ84951-1.jpg
 * reads as the first of a set somebody has to go and find the rest of.
 */
export function photographName(
  { serial, stockNo, index, total, mimeType }: {
    serial: string | null | undefined
    stockNo: number
    /** Zero-based position among this watch's photographs. */
    index: number
    total: number
    mimeType: string
  },
): string {
  const stem = photographStem(serial, stockNo)
  const suffix = total > 1 && index > 0 ? `-${index + 1}` : ''
  return `${stem}${suffix}.${EXTENSIONS[mimeType] ?? 'jpg'}`
}
