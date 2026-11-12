'use client'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Check, X } from 'lucide-react'
import { claimAction, type CampaignState } from '@/app/actions/partner-campaigns'
import {
  BOX_PAPERS_LABELS, CONDITION_LABELS, type BoxPapers, type Condition,
} from '@/lib/enums'
import type { RecipientView } from '@/server/services/partner-campaign-service'

const INITIAL: CampaignState = { ok: false, message: '' }

function money(base: number): string {
  return `AED ${Math.round(base / 100).toLocaleString('en-GB')}`
}

type Choice = RecipientView['choices'][number]

const describe = (item: { brandName: string; model: string | null; modelName: string | null }): string =>
  [item.brandName, item.model, item.modelName].filter(Boolean).join(' ')

/** The line under the name, in the plainest words a dealer would use. */
const details = (item: Choice): string =>
  [
    item.year,
    item.caseSizeMm ? `${item.caseSizeMm}mm` : null,
    item.dial,
    item.condition ? CONDITION_LABELS[item.condition as Condition] : null,
    item.boxPapers && item.boxPapers !== 'UNKNOWN'
      ? BOX_PAPERS_LABELS[item.boxPapers as BoxPapers]
      : null,
  ].filter(Boolean).join(' · ')

/**
 * What one person sees when they open their link.
 *
 * Not a shop. The person reading this did not come to buy a watch — their
 * employer told them to pick one, and most of them will never have chosen a
 * watch before. So: their name at the top, their company's words under it,
 * and a small number of things to choose between. No search, no sort, no
 * filters, nothing to sign in to and nothing to pay.
 *
 * Prices appear on a budget campaign and not on a shortlist. On a budget they
 * are the whole mechanic — you cannot spend an amount without seeing what
 * things cost. On a shortlist the employer has already chosen what is on
 * offer, so a price tag does two unhelpful things: it puts a number on a gift,
 * and it tells a few dozen employees what their company negotiated with us.
 */
export function RecipientChoice({ token, view }: { token: string; view: RecipientView }) {
  const [taking, setTaking] = useState<Choice | null>(null)
  const { campaign, recipient } = view
  const showPrices = campaign.kind === 'BUDGET'
  const live = campaign.status === 'OPEN'

  /*
   * Split once, here, rather than filtered twice in the markup.
   *
   * The service has already worked out what each watch leaves to pay and
   * sorted the covered ones first, so this is only where one list becomes
   * two headings.
   */
  const covered = view.choices.filter((item) => item.topUpGbp === 0)
  const topUp = view.choices.filter((item) => item.topUpGbp > 0)

  return (
    <main
      className="min-h-screen bg-white"
      style={{
        ['--brand' as string]: campaign.brandColor,
        ['--accent' as string]: campaign.accentColor,
      }}
    >
      <header className="border-b border-black/10 px-5 py-9 sm:px-8">
        <div className="mx-auto max-w-[1180px]">
          {campaign.hasLogo ? (
            /* Their employer's mark, not ours. Somebody opening this has been
               told by their own office to expect it, and a page carrying a
               watch dealer's branding instead reads as a mailshot. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={`/r/${token}/logo`} alt={campaign.partnerName} className="h-8 w-auto object-contain" />
          ) : (
            <p className="text-[12px] uppercase tracking-[0.1em] text-black/40">
              {campaign.partnerName}
            </p>
          )}
          <h1 className="mt-2 font-serif text-[30px] leading-tight text-black sm:text-[34px]">
            {recipient.claimedAt
              ? `Thank you, ${recipient.name}`
              : live
                ? `${recipient.name}, choose your watch`
                : `Hello, ${recipient.name}`}
          </h1>
          {campaign.intro && (
            <p className="mt-3 max-w-[620px] text-[14.5px] leading-relaxed text-black/60">
              {campaign.intro}
            </p>
          )}
          {!recipient.claimedAt && live && showPrices && campaign.budgetBase !== null && (
            /*
             * The award, and what it means for the two groups below.
             *
             * It used to read "everything below is within that", which was
             * true and also the whole problem: the list stopped at the award.
             * Said this way the award is a starting point, and the second
             * group is an invitation rather than a tease.
             */
            <p className="mt-3 max-w-[620px] text-[13.5px] leading-relaxed text-black/60">
              You have{' '}
              <span className="font-semibold text-black">{money(campaign.budgetBase)}</span>{' '}
              to put toward a watch. The first ones below are yours for that
              alone — for any of the others, you add the difference shown.
            </p>
          )}
        </div>
      </header>

      {!live && !recipient.claimedAt ? (
        /*
         * A real link to a campaign that is not running.
         *
         * The first thing that went wrong in practice: a link copied and sent
         * the moment somebody was added, before the campaign was opened. It
         * used to answer with nothing at all, which tells an employee their
         * company's gift does not exist. They are holding a token we issued
         * them, so saying which of the two it is costs nothing.
         */
        <div className="mx-auto max-w-[620px] px-5 py-16 text-center sm:px-8">
          <p className="font-serif text-[22px] leading-snug text-black">
            {campaign.status === 'DRAFT' ? 'This is not open yet' : 'This has closed'}
          </p>
          <p className="mt-3 text-[14px] leading-relaxed text-black/55">
            {campaign.status === 'DRAFT'
              ? 'Your link works — there is simply nothing to choose from yet. Keep it, and try again shortly.'
              : 'The time for choosing has passed. If you think that is a mistake, speak to whoever sent you this.'}
          </p>
        </div>
      ) : recipient.claimedAt ? (
        /*
         * Afterwards.
         *
         * The page stays at their own link rather than expiring, and says what
         * they chose. Somebody who clicks the link again a week later is
         * checking they did it right, and an empty page or a dead link is the
         * worst possible answer to that.
         */
        <div className="mx-auto max-w-[620px] px-5 py-16 text-center sm:px-8">
          <Check className="mx-auto h-8 w-8" style={{ color: 'var(--accent)' }} aria-hidden />
          <p className="mt-4 font-serif text-[22px] leading-snug text-black">
            {view.chosen ? describe(view.chosen) : 'Your watch is chosen'}
          </p>
          <p className="mt-3 text-[14px] leading-relaxed text-black/55">
            It is set aside for you. Somebody will be in touch through{' '}
            {campaign.partnerName} to arrange the rest — there is nothing else for you to do,
            and nothing to pay.
          </p>
        </div>
      ) : view.choices.length === 0 ? (
        <div className="mx-auto max-w-[620px] px-5 py-16 text-center sm:px-8">
          <p className="text-[14px] leading-relaxed text-black/55">
            There is nothing available to choose from at the moment. Please check back, or
            speak to whoever sent you this.
          </p>
        </div>
      ) : (
        <div className="mx-auto max-w-[1180px] px-5 py-9 sm:px-8">
          {showPrices && covered.length > 0 && (
            <h2 className="mb-5 font-serif text-[21px] text-black">
              Yours for the award alone
            </h2>
          )}
          <ul className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {(showPrices ? covered : view.choices).map((item) => (
              <li key={item.id} className="flex h-full flex-col">
                <div className="aspect-square w-full overflow-hidden bg-black/[0.02]">
                  {item.imageIds[0] && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`/r/${token}/image/${item.imageIds[0]}`}
                      alt={describe(item)}
                      loading="lazy"
                      className="h-full w-full object-contain p-4 mix-blend-multiply"
                    />
                  )}
                </div>

                <p className="mt-4 line-clamp-2 min-h-[2.6em] font-serif text-[18px] leading-snug text-black">
                  {describe(item)}
                </p>
                <p className="mt-1 line-clamp-1 min-h-[1.3em] text-[12.5px] text-black/50">
                  {details(item)}
                </p>

                {showPrices && (
                  /*
                   * The value, said to be covered.
                   *
                   * A bare price under "yours for the award alone" reads as
                   * something to pay — which is the opposite of what it is.
                   * Keeping the figure is worth it: somebody should see what
                   * they are being given is worth.
                   */
                  <p className="mt-2 text-[15px] tabular-nums text-black">
                    <span className="font-semibold">{money(item.priceGbp)}</span>
                    <span className="ml-2 text-[12.5px] font-normal text-black/45">
                      covered by your award
                    </span>
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => setTaking(item)}
                  className="mt-4 h-11 w-full text-[12px] font-semibold uppercase tracking-[0.08em] text-white"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  Choose this one
                </button>
              </li>
            ))}
          </ul>

          {showPrices && topUp.length > 0 && (
            <>
              <h2 className="mb-2 mt-14 font-serif text-[21px] text-black">
                Or put your award toward one of these
              </h2>
              <p className="mb-5 max-w-[620px] text-[13.5px] leading-relaxed text-black/55">
                Your {campaign.budgetBase !== null ? money(campaign.budgetBase) : 'award'} comes
                off each of these. The figure shown is what would be left for you to pay.
              </p>
              <ul className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
                {topUp.map((item) => (
                  <li key={item.id} className="flex h-full flex-col">
                    <div className="aspect-square w-full overflow-hidden bg-black/[0.02]">
                      {item.imageIds[0] && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={`/r/${token}/image/${item.imageIds[0]}`}
                          alt={describe(item)}
                          loading="lazy"
                          className="h-full w-full object-contain p-4 mix-blend-multiply"
                        />
                      )}
                    </div>

                    <p className="mt-4 line-clamp-2 min-h-[2.6em] font-serif text-[18px] leading-snug text-black">
                      {describe(item)}
                    </p>
                    <p className="mt-1 line-clamp-1 min-h-[1.3em] text-[12.5px] text-black/50">
                      {details(item)}
                    </p>

                    {/*
                      * The number that decides this, which is what is left to
                      * pay — not the price. The price is there underneath so
                      * nobody feels a figure has been kept from them.
                      */}
                    <p className="mt-2 text-[15px] font-semibold tabular-nums text-black">
                      {money(item.topUpGbp)} to pay
                    </p>
                    <p className="text-[12px] tabular-nums text-black/45">
                      {money(item.priceGbp)} less your award
                    </p>

                    <button
                      type="button"
                      onClick={() => setTaking(item)}
                      className="mt-4 h-11 w-full border text-[12px] font-semibold uppercase tracking-[0.08em]"
                      style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}
                    >
                      Choose this one
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {taking && (
        <ConfirmChoice
          token={token}
          item={taking}
          showPrice={showPrices}
          onClose={() => setTaking(null)}
        />
      )}
    </main>
  )
}

/**
 * The confirmation, which exists because this cannot be undone by the person.
 *
 * One watch each. Somebody who picks the wrong one has to ring their own HR
 * department and then us, so the dialog says plainly that this is the choice,
 * rather than letting a mis-tap settle it.
 */
function ConfirmChoice({ token, item, showPrice, onClose }: {
  token: string
  item: Choice
  showPrice: boolean
  onClose: () => void
}) {
  const [state, action] = useFormState<CampaignState, FormData>(
    claimAction.bind(null, token),
    INITIAL,
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`Choose ${describe(item)}`}
    >
      <div className="w-full max-w-[420px] bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-serif text-[20px] leading-snug text-black">{describe(item)}</p>
            {showPrice && (
              /*
               * What they pay, said before they commit and not after.
               *
               * A dialog that showed the watch's price on a piece needing a
               * top-up would be the last thing somebody read before agreeing
               * to a number nobody had put in front of them.
               */
              item.topUpGbp > 0 ? (
                <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-black/80">
                  {money(item.topUpGbp)} for you to pay
                  <span className="ml-1.5 text-[12.5px] font-normal text-black/45">
                    ({money(item.priceGbp)} less your award)
                  </span>
                </p>
              ) : (
                <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-black/80">
                  Covered by your award
                </p>
              )
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-black/40 hover:text-black">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {state.ok ? (
          <>
            <p className="mt-5 text-[13.5px] leading-relaxed text-black/70">{state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 h-11 w-full text-[12.5px] font-semibold uppercase tracking-[0.08em] text-white"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              Done
            </button>
          </>
        ) : (
          <form action={action} className="mt-5 space-y-3">
            <input type="hidden" name="watchId" value={item.id} />
            <p className="text-[13.5px] leading-relaxed text-black/60">
              This is your choice, and it is one watch — once it is made, we set this
              one aside for you.
              {showPrice && item.topUpGbp > 0 && (
                <> Nothing is charged now: somebody will be in touch about the{' '}
                  <span className="font-semibold text-black">{money(item.topUpGbp)}</span>{' '}
                  before anything is arranged.
                </>
              )}
            </p>
            <label className="block">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-black/55">
                Anything we should know (optional)
              </span>
              <textarea
                name="note"
                rows={2}
                placeholder="Sizing, engraving, when you need it"
                className="mt-1 w-full border border-black/15 px-3 py-2 text-[14px] text-black outline-none placeholder:text-black/30 focus:border-black/50"
              />
            </label>

            {state.message && !state.ok && (
              <p role="alert" className="text-[12.5px] text-[#b42318]">{state.message}</p>
            )}

            <Confirm />
          </form>
        )}
      </div>
    </div>
  )
}

function Confirm() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 w-full text-[12.5px] font-semibold uppercase tracking-[0.08em] text-white disabled:opacity-60"
      style={{ backgroundColor: 'var(--brand)' }}
    >
      {pending ? 'One moment…' : 'Yes, this one'}
    </button>
  )
}
