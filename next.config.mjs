/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
