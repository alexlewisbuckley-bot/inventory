'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertOctagon, Lock } from 'lucide-react'
import { Button } from '@/components/ui'

/**
 * The shell's error boundary, which knows a refusal from a crash.
 *
 * A ForbiddenError carries the digest `FORBIDDEN` (see src/lib/errors.ts),
 * so a permission refusal renders as what it is — "this screen is not part
 * of your role" — instead of "something went wrong, try again", which for a
 * refusal is untrue twice: nothing went wrong, and trying again will not
 * help. Everything else falls through to the crash treatment with its
 * quotable reference.
 */
export default function AppError({ error, reset }: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const forbidden = error.digest === 'FORBIDDEN'

  useEffect(() => {
    if (forbidden) return
    console.error('app error boundary', { digest: error.digest })
  }, [error, forbidden])

  if (forbidden) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-20 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-subtle text-content-secondary" aria-hidden>
          <Lock className="h-6 w-6" />
        </span>
        <h1 className="text-h2 font-extrabold text-content-primary">Not part of your role</h1>
        <p className="text-small text-content-secondary">
          This screen is not included in what your account can see. If you think it
          should be, ask whoever manages users to change your role.
        </p>
        <Link href="/today" className="mt-2 inline-flex h-11 items-center rounded-pill bg-teal-500 px-5 text-body font-bold text-navy-900">
          Back to Today
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-20 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-state-critical/10 text-state-critical" aria-hidden>
        <AlertOctagon className="h-6 w-6" />
      </span>
      <h1 className="text-h2 font-extrabold text-content-primary">Something went wrong</h1>
      <p className="text-small text-content-secondary">
        The error has been logged. You can retry, or head back — nothing you had
        saved will have been lost.
      </p>
      {error.digest && (
        <p className="rounded-md bg-surface-raised px-4 py-2 font-mono text-caption text-content-secondary">
          Reference: {error.digest}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link href="/today" className="inline-flex h-11 items-center rounded-pill border-[1.5px] border-navy-700 px-5 text-body font-bold text-navy-700">
          Back to Today
        </Link>
      </div>
    </div>
  )
}
