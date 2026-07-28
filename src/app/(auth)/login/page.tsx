import type { Metadata } from 'next'
import { LoginForm } from '@/components/auth/LoginForm'

export const metadata: Metadata = { title: 'Sign in' }

export default function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  return (
    <main id="main" className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel — hidden on small screens where it would push the form
          below the fold. */}
      <section className="relative hidden flex-col justify-between bg-navy-900 p-12 lg:flex">
        <div className="flex items-center gap-2">
          <span className="text-h3 font-extrabold text-white">bluecroft</span>
          <span className="h-2 w-2 rounded-pill bg-teal-500" aria-hidden />
        </div>
        <div className="max-w-md">
          <h1 className="text-display font-extrabold leading-tight text-white">
            Every watch, every location, one source of truth.
          </h1>
          <p className="mt-4 text-body-lg text-content-inverse-muted">
            Stock levels, capital tied up and realised margin — live, and shared
            across the team.
          </p>
        </div>
        <p className="text-caption text-content-inverse-muted">
          Bluecroft Finance Limited · Internal system · Authorised users only
        </p>
      </section>

      <section className="flex items-center justify-center bg-surface-page px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="text-h3 font-extrabold text-content-primary">bluecroft</span>
            <span className="h-2 w-2 rounded-pill bg-teal-500" aria-hidden />
          </div>
          <h2 className="text-h1 font-extrabold text-content-primary">Sign in</h2>
          <p className="mt-2 text-body text-content-secondary">
            Use your Bluecroft account to access the stock system.
          </p>
          <LoginForm redirectTo={searchParams.next} />
        </div>
      </section>
    </main>
  )
}
