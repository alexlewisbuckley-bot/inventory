import Link from 'next/link'
import { FileQuestion } from 'lucide-react'
import { LinkButton } from '@/components/ui'

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-surface-subtle px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-lg bg-surface-raised text-content-secondary">
          <FileQuestion className="h-7 w-7" aria-hidden />
        </div>
        <p className="text-caption font-semibold uppercase tracking-wide text-content-secondary">Error 404</p>
        <h1 className="mt-2 text-h1 font-extrabold text-content-primary">We can&apos;t find that page</h1>
        <p className="mt-3 text-body text-content-secondary">
          The link may be out of date, or the record may have been deleted. Check the
          inventory list — deleted stock can still be found there.
        </p>
        <div className="mt-7 flex items-center justify-center gap-3">
          <LinkButton href="/">Back to dashboard</LinkButton>
          <Link href="/inventory" className="text-body font-bold text-content-accent hover:underline">
            Go to inventory
          </Link>
        </div>
      </div>
    </main>
  )
}
