'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { Lock } from 'lucide-react'
import { enterTradeRoomAction, type GateState } from '@/app/actions/trade-room'

/**
 * The door.
 *
 * It says as little as it can get away with. There is no account here, no
 * email, nothing to reset and no way to sign up — so every one of the usual
 * props of a sign-in page would be a false promise. What it is: a page that
 * wants a passphrase somebody gave you, with the name of the house on it so
 * you know you are at the right address.
 *
 * The reseller's own mark and colours, because a dealer is going to be handed
 * this link by them and a page that looks like somebody else's software is a
 * page they check twice before typing anything into.
 */
export function TradeGate({ token, name, hasLogo, publicToken, brandColor, accentColor }: {
  token: string
  name: string
  hasLogo: boolean
  publicToken: string
  brandColor: string
  accentColor: string
}) {
  const [state, action] = useFormState<GateState, FormData>(
    enterTradeRoomAction.bind(null, token),
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
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/t/${token}/logo?v=${publicToken.slice(0, 6)}`}
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
            Trade stock
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-black/55">
            Photographs of the actual watches, for the trade. Enter the passphrase you
            were given.
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
          Lost the passphrase? Ask {name} — it cannot be recovered, only replaced.
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
