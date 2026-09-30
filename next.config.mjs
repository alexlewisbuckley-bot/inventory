import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(fileURLToPath(import.meta.url))

/**
 * Is a piece of brand artwork in the repository?
 *
 * Asked here, during the build, and baked into the bundle as a literal —
 * not asked at request time, which is where this started and where it does
 * not work. `public/` is served by the static layer and is not part of the
 * serverless function's filesystem, so a runtime `existsSync` against the
 * working directory says "no artwork" in production however many files are
 * actually deployed. The file served happily over HTTP while the server
 * rendering the page believed it was missing, and every bar fell back to the
 * typeset name.
 *
 * The build runs against the real checkout, so this is the one moment the
 * question has a reliable answer.
 */
const brandArtwork = (file) =>
  existsSync(join(projectRoot, 'public', 'brand', file)) ? 'present' : 'absent'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    BRAND_WORDMARK: brandArtwork('wordmark.svg'),
    BRAND_MONOGRAM: brandArtwork('monogram.svg'),
  },
  // Next's font optimiser fetches external stylesheets during the build, which
  // fails in restricted CI and air-gapped builds. The webfont is requested by
  // the browser at runtime instead, behind a full system-font fallback stack,
  // so the build has no external network dependency.
  // For production, self-host the font files and drop the <link> entirely.
  optimizeFonts: false,
  experimental: { optimizePackageImports: ['lucide-react', 'date-fns'] },
  // E7e: the board lives at /deals — "the pipeline is a view, not a place".
  // Permanent redirects, kept indefinitely, so bookmarks and shared links
  // from before the rename never break.
  async redirects() {
    return [
      { source: '/pipeline', destination: '/deals', permanent: true },
      { source: '/pipeline/:id', destination: '/deals/:id', permanent: true },
    ]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}
export default nextConfig
