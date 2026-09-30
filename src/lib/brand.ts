/**
 * Is the supplied logo artwork actually here?
 *
 * Answered when the application is built, by `next.config.mjs`, which looks
 * at the repository and inlines the result. Nothing is read from the
 * filesystem here, and that is the point.
 *
 * This has been wrong twice, in ways worth keeping a note of. The first
 * attempt was an `onError` handler on the image: it cannot work, because the
 * image is server-rendered, so a missing file fails while the page is still
 * being parsed, long before React hydrates and attaches anything — the
 * broken-image glyph is already on screen. The second attempt asked the
 * filesystem at request time, which is correct on a machine running the
 * application out of its own directory and wrong everywhere it is actually
 * deployed: `public/` is served by the static layer and is not part of the
 * serverless bundle, so the answer was always "absent" in production. The
 * artwork downloaded perfectly well over HTTP while the server rendering the
 * page insisted it was not there.
 *
 * The build is the one moment the question can be answered reliably, so it is
 * answered there, once.
 */
export function hasBrandArtwork(): boolean {
  return process.env.BRAND_WORDMARK === 'present'
}

export function hasBrandMonogram(): boolean {
  return process.env.BRAND_MONOGRAM === 'present'
}
