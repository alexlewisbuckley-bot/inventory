import type { Metadata } from 'next'
import { LoginForm } from '@/components/auth/LoginForm'
import { Wordmark } from '@/components/layout/Wordmark'

export const metadata: Metadata = { title: 'Sign in' }

export default function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  return (
    <main id="main" className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel — hidden on small screens where it would push the form
          below the fold. */}
      {/* The Obsidian ground from the brand pack, which is where the mark is
          meant to sit when it is not on Ivory. */}
      <section className="relative hidden flex-col justify-between bg-surface-inverse p-12 lg:flex">
        <Wordmark onInverse />
        <div className="max-w-md">
          <h1 className="text-display font-extrabold leading-tight text-content-inverse">
            Every watch, every location, one source of truth.
          </h1>
          <p className="mt-4 text-body-lg text-content-inverse-muted">
            Stock levels, capital tied up and realised margin — live, and shared
            across the team.
          </p>
        </div>
        <p className="text-caption text-content-inverse-muted">
          One Street Watches · Internal system · Authorised users only
        </p>
      </section>

      <section className="flex items-center justify-center bg-surface-page px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Wordmark />
          </div>
          <h2 className="text-h1 font-extrabold text-content-primary">Sign in</h2>
          <p className="mt-2 text-body text-content-secondary">
            Use your One Street Watches account to access the stock system.
          </p>
          <LoginForm redirectTo={searchParams.next} />
        </div>
      </section>
    </main>
  )
}
