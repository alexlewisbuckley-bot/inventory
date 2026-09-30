import type { Metadata, Viewport } from 'next'
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
  description: 'Internal luxury watch inventory management for Bluecroft.',
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
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
