import type { Metadata, Viewport } from 'next'
import { hasBrandArtwork, hasBrandMonogram } from '@/lib/brand'
import { BrandProvider } from '@/components/layout/BrandProvider'
import { ThemeProvider, themeScript } from '@/components/ui/ThemeProvider'
import { ToastProvider } from '@/components/ui/Toast'
/**
 * The typeface, self-hosted.
 *
 * It used to be fetched from Google's CDN by every browser on every cold load:
 * a third-party request in the critical path, a privacy exposure for a company
 * trading in the EU, and a silent fall back to the system stack whenever the
 * request was blocked — which is what happens behind a corporate proxy, and
 * what was happening here. The weight-variable woff2 ships in the package and
 * is served from this origin, so it is either present or the build fails.
 */
// The optical-size axis, not just weight: this interface runs from a
// 10px tracked label to a display figure on a stat tile, and Inter's opsz
// is what keeps the small end from closing up and the large end from
// looking loose.
import '@fontsource-variable/inter/opsz.css'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: { default: 'One Street Watches', template: '%s · One Street Watches' },
  /*
   * The OS symbol, from `public/brand/`, and only when it is actually there:
   * a <link rel=icon> pointing at a 404 leaves some browsers showing nothing
   * rather than falling back to their default.
   */
  ...(hasBrandMonogram()
    ? { icons: { icon: [{ url: '/brand/monogram.svg', type: 'image/svg+xml' }] } }
    : {}),
  description: 'Internal luxury watch inventory management for One Street Watches.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#071023' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        {/* Applied before paint so dark-mode users never see a light flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only-focusable absolute left-4 top-4 z-[100] rounded-md bg-navy-700 px-4 py-2 text-body font-bold text-content-on-brand"
        >
          Skip to main content
        </a>
        {/* Looked up here, on the server, because the bars that draw the
            mark are client components and cannot read the filesystem. */}
        <BrandProvider value={{ wordmark: hasBrandArtwork(), monogram: hasBrandMonogram() }}>
          <ThemeProvider>
            <ToastProvider>{children}</ToastProvider>
          </ThemeProvider>
        </BrandProvider>
      </body>
    </html>
  )
}
