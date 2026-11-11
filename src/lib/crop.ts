/**
 * Cutting one watch out of a photograph of several.
 *
 * The review screen leads each row with the watch it is about. Alex, of the
 * first version, which led with a sentence instead: "its also super old
 * fashioned and clunky". A position in words — "left column, third from
 * top" — asks somebody to hold a coordinate in their head and go looking,
 * and on a tray of seven that is seven searches. A picture of the watch
 * beside the numbers read off its card is a glance.
 *
 * Done in the browser, on the file already in hand, so no second copy of the
 * photograph is uploaded, stored or paid for.
 */

export interface CropBox {
  /** All four as percentages of the whole image, which survive a downscale. */
  x: number
  y: number
  w: number
  h: number
}

/** A little air around the box, so a watch is not shaved by a tight estimate. */
const PADDING = 0.06

/** The longest edge of a thumbnail. Larger than it renders, for sharp screens. */
const EDGE = 192

/**
 * One watch, as a data URL, or null.
 *
 * Null for every way this can fail — no box, an image the browser cannot
 * decode, a canvas that will not give its pixels back — because the row has
 * somewhere to fall back to: the position in words it had before. A missing
 * thumbnail is a worse row, not a broken screen.
 */
export async function cropToDataUrl(file: File, box: CropBox | null): Promise<string | null> {
  if (!box || box.w <= 0 || box.h <= 0) return null
  if (typeof createImageBitmap !== 'function') return null

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }

  try {
    const pad = Math.max(box.w, box.h) * PADDING
    // Clamped to the image: a box the model drew a little past the edge
    // should still produce the watch rather than nothing.
    const left = Math.max(0, (box.x - pad) / 100) * bitmap.width
    const top = Math.max(0, (box.y - pad) / 100) * bitmap.height
    const right = Math.min(100, box.x + box.w + pad) / 100 * bitmap.width
    const bottom = Math.min(100, box.y + box.h + pad) / 100 * bitmap.height

    const width = Math.round(right - left)
    const height = Math.round(bottom - top)
    if (width < 8 || height < 8) return null

    const scale = Math.min(1, EDGE / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)

    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, left, top, width, height, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.82)
  } catch {
    return null
  } finally {
    bitmap.close()
  }
}
