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

export async function downscaleImage(
  file: File,
  { maxEdge = 1600, quality = 0.82 }: { maxEdge?: number; quality?: number } = {},
): Promise<DownscaleResult> {
  if (!file.type.startsWith('image/')) return { file, width: 0, height: 0 }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return { file, width: 0, height: 0 }
  }

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  // Already small enough, and not a format worth re-encoding.
  if (scale === 1 && file.size < 1_000_000) {
    bitmap.close()
    return { file, width, height }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    return { file, width, height }
  }
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  )
  if (!blob) return { file, width, height }

  // Keep the original if re-encoding somehow made it larger.
  if (blob.size >= file.size) return { file, width, height }

  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
  return { file: new File([blob], name, { type: 'image/jpeg' }), width, height }
}
