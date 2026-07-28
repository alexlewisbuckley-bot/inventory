import type { Metadata, Viewport } from 'next'
import { ThemeProvider, themeScript } from '@/components/ui/ThemeProvider'
import { ToastProvider } from '@/components/ui/Toast'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: { default: 'Bluecroft Stock', template: '%s · Bluecroft Stock' },
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Requested by the browser at runtime, not inlined at build time, so
            the build never depends on an external host. `display=swap` plus the
            system fallback stack in tailwind.config.ts means text is readable
            immediately and correct if the request fails.
            Production hardening: self-host the woff2 files and remove this. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only-focusable absolute left-4 top-4 z-[100] rounded-md bg-navy-700 px-4 py-2 text-body font-bold text-white"
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
