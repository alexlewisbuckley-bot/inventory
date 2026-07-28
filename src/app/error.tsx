'use client'
import { useEffect } from 'react'
import { AlertOctagon } from 'lucide-react'
import { Button, LinkButton } from '@/components/ui'

/**
 * Root error boundary. The digest is surfaced so a user can quote it to
 * support, while the underlying message stays server-side.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(JSON.stringify({
      level: 'error', message: 'unhandled client error',
      error: error.message, digest: error.digest, time: new Date().toISOString(),
    }))
  }, [error])

  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-surface-subtle px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-lg bg-state-danger/10 text-state-danger">
          <AlertOctagon className="h-7 w-7" aria-hidden />
        </div>
        <h1 className="text-h1 font-extrabold text-content-primary">Something went wrong</h1>
        <p className="mt-3 text-body text-content-secondary">
          The error has been logged. You can retry, or head back to the dashboard —
          nothing you had saved will have been lost.
        </p>
        {error.digest && (
          <p className="mt-4 rounded-sm bg-surface-raised px-3 py-2 font-mono text-caption text-content-secondary">
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-7 flex items-center justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <LinkButton href="/" variant="secondary">Back to dashboard</LinkButton>
        </div>
      </div>
    </main>
  )
}
