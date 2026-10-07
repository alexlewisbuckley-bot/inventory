/**
 * Downscale an image in the browser before uploading.
 *
 * A phone photograph is commonly 4–12 MB, which is slow on a showroom
 * connection, exceeds serverless request body limits, and is far more detail
 * than a stock record needs. Resizing client-side means the network only ever
 * carries the version that gets stored.
 *
 * Returns the original file untouched if the browser cannot decode it, so an
 * unusual format still reaches the server-side validator rather than failing
 * silently here.
 */
export interface DownscaleResult {
  file: File
  width: number
  height: number
}

/**
 * The format an iPhone actually takes photographs in.
 *
 * HEIC is the default on every iPhone since 2017, so a photograph AirDropped
 * off a phone arrives as one — and no browser but Safari can decode it. The
 * file picker hid them, the downscaler could not read them, and the server
 * refused the type: three separate refusals, none of which said the word
 * HEIC, for the single commonest way a photograph gets onto a Mac.
 *
 * Matched on the name as well as the type because the type is often missing.
 * A file that arrives over AirDrop, or is dragged out of Photos, frequently
 * reaches the browser with `type` set to the empty string — the extension is
 * then the only evidence there is.
 */
export function looksLikeHeic(file: { name: string; type: string }): boolean {
  if (/^image\/(heic|heif)/i.test(file.type)) return true
  return /\.(heic|heif)$/i.test(file.name)
}

/**
 * Whether a dropped file is a photograph this system can take.
 *
 * Not `type.startsWith('image/')`, which is what three different drop zones
 * asked and is why an AirDropped iPhone photograph vanished on being
 * dropped: the browser hands those over with `type` set to the empty string
 * surprisingly often, so the test threw the file away before anything had a
 * chance to convert it. Nothing appeared, and nothing said why.
 */
export function isUploadableImage(file: { name: string; type: string }): boolean {
  return file.type.startsWith('image/') || looksLikeHeic(file)
}

/**
 * A HEIC turned into something the rest of the pipeline can read.
 *
 * The decoder is a WebAssembly build of libheif and about a megabyte and a
 * half, so it is imported at the moment it is needed rather than shipped to
 * everybody who opens a watch. Somebody who never uploads an iPhone
 * photograph never downloads it.
 *
 * Quality is high here and the real compression happens afterwards: this
 * output is an intermediate that is about to be scaled to 1600px and
 * re-encoded, and losing detail twice shows.
 */
async function decodeHeic(file: File): Promise<File> {
  const { heicTo } = await import('heic-to/next')
  const blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 })
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' })
}

export async function downscaleImage(
  file: File,
  { maxEdge = 1600, quality = 0.82 }: { maxEdge?: number; quality?: number } = {},
): Promise<DownscaleResult> {
  // Before anything else looks at it, because everything else is written for
  // a format the browser can decode — including the `image/` check below,
  // which an AirDropped HEIC fails by having no type at all.
  let source = file
  if (looksLikeHeic(file)) {
    try {
      source = await decodeHeic(file)
    } catch {
      // Leave it as it came. The server's validator gives a clearer account
      // of an unreadable file than anything that could be invented here.
      return { file, width: 0, height: 0 }
    }
  }

  if (!source.type.startsWith('image/')) return { file: source, width: 0, height: 0 }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(source)
  } catch {
    return { file: source, width: 0, height: 0 }
  }

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  // Already small enough, and not a format worth re-encoding.
  if (scale === 1 && source.size < 1_000_000) {
    bitmap.close()
    return { file: source, width, height }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    return { file: source, width, height }
  }
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  )
  if (!blob) return { file: source, width, height }

  // Keep the decoded original if re-encoding somehow made it larger. Decoded,
  // not the one that came in: comparing against a HEIC would sometimes hand
  // back the HEIC, which is the one thing this function exists to avoid.
  if (blob.size >= source.size) return { file: source, width, height }

  const name = `${source.name.replace(/\.[^.]+$/, '')}.jpg`
  return { file: new File([blob], name, { type: 'image/jpeg' }), width, height }
}
