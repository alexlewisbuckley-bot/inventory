'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { Lock } from 'lucide-react'
import { enterPortalAction, type GateState } from '@/app/actions/partner-portal'

/**
 * The door.
 *
 * It says as little as it can get away with. There is no account here, no
 * email, nothing to reset and no way to sign up — so every one of the usual
 * props of a sign-in page would be a false promise. What it is: a page that
 * wants a passphrase somebody gave you, with the name of the company it was
 * opened for on it, so you know you are at the right address.
 *
 * Their colours, not ours. Somebody at an estate agency is handed this link by
 * their own office, and a page that looks like a stranger's software is a page
 * they check twice before typing anything into.
 */
export function PortalGate({ token, name, hasLogo, brandColor, accentColor }: {
  token: string
  name: string
  hasLogo: boolean
  brandColor: string
  accentColor: string
}) {
  // Bound into the action rather than carried as a form field. The browser
  // already has the token — it is in the address bar — but a hidden input
  // would also put it in the page body, where a copied snippet of markup
  // carries the door with it.
  const [state, action] = useFormState<GateState, FormData>(
    enterPortalAction.bind(null, token),
    { ok: false, message: '' },
  )

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-white px-5 py-16"
      style={{
        ['--brand' as string]: brandColor,
        ['--accent' as string]: accentColor,
      }}
    >
      <div className="w-full max-w-[360px]">
        {hasLogo ? (
          /* Their mark, on the door. Somebody handed this link by their own
             office checks twice before typing anything into a page that looks
             like a stranger's software. */
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/p/${token}/logo`}
            alt={name}
            className="mx-auto mb-8 h-10 w-auto object-contain"
          />
        ) : (
          <p
            className="mb-8 text-center font-serif text-[22px] tracking-tight"
            style={{ color: 'var(--brand)' }}
          >
            {name}
          </p>
        )}

        <div className="border border-black/10 p-7">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-black/80">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            Partner access
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-black/55">
            Stock at your agreed rate. Enter the passphrase you were given.
          </p>

          <form action={action} className="mt-5">
            <label className="block">
              <span className="sr-only">Passphrase</span>
              <input
                name="passphrase"
                type="password"
                autoComplete="off"
                autoFocus
                required
                placeholder="Passphrase"
                aria-invalid={state.message ? true : undefined}
                aria-describedby={state.message ? 'gate-error' : undefined}
                className="h-11 w-full border border-black/15 px-3 text-[14px] text-black outline-none placeholder:text-black/35 focus:border-black/50"
              />
            </label>

            {state.message && (
              <p id="gate-error" role="alert" className="mt-2.5 text-[12.5px] text-[#b42318]">
                {state.message}
              </p>
            )}

            <Submit />
          </form>
        </div>

        <p className="mt-5 text-center text-[11.5px] leading-relaxed text-black/40">
          Lost the passphrase? Ask whoever sent you this link — it cannot be
          recovered, only replaced.
        </p>
      </div>
    </main>
  )
}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-3 h-11 w-full text-[13px] font-semibold uppercase tracking-[0.08em] text-white transition-opacity disabled:opacity-60"
      style={{ backgroundColor: 'var(--brand)' }}
    >
      {/* The wait is scrypt, which is slow on purpose. Saying so is the
          difference between a slow page and a broken one. */}
      {pending ? 'Checking…' : 'Enter'}
    </button>
  )
}
