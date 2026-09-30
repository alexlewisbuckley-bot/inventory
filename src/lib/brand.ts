import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Is the supplied logo artwork actually here?
 *
 * Asked on the server, once, at render — not in the browser with an `onError`
 * handler. That was the first attempt and it does not work: the image is in
 * the server-rendered HTML, so a missing file fails while the page is still
 * being parsed, long before React hydrates and attaches the handler. The
 * error goes nowhere and the reader is left looking at a broken-image glyph
 * beside the alt text.
 *
 * A filesystem check has no such race. The answer is written onto the
 * document element and the stylesheet shows whichever of the two the answer
 * calls for, so the correct one is in the first byte of HTML.
 */
export function hasBrandArtwork(): boolean {
  return existsSync(join(process.cwd(), 'public', 'brand', 'wordmark.svg'))
}

export function hasBrandMonogram(): boolean {
  return existsSync(join(process.cwd(), 'public', 'brand', 'monogram.svg'))
}
