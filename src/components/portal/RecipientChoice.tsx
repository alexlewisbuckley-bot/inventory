'use client'
import { useMemo, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Check, X } from 'lucide-react'
import { claimAction, type CampaignState } from '@/app/actions/partner-campaigns'
import {
  BOX_PAPERS_LABELS, CONDITION_LABELS, type BoxPapers, type Condition,
} from '@/lib/enums'
import { FilterBar, FilterRail, SortSelect } from './FilterRail'
import { WatchCard, WatchGrid } from './WatchCard'
import { applyFilters, money, priceBands, sizeBands, NO_FILTERS, type FilterState } from './filters'
import type { RecipientView } from '@/server/services/partner-campaign-service'

const INITIAL: CampaignState = { ok: false, message: '' }

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
 * A name to greet somebody by — or nothing, when all we were given is where
 * to email them.
 *
 * Campaigns get loaded from a spreadsheet, and the name column is often the
 * address. "alexlewis.buckley@gmail.com, choose your watch" in 34px serif was
 * the first thing a winner saw, which is a worse greeting than no greeting:
 * it reads as a mailshot that failed to merge. So when the name is an
 * address, the page simply does not use a name.
 */
export function greeting(name: string, claimed: boolean, live: boolean): string {
  const person = name.trim()
  const usable = person && !person.includes('@') ? person : null
  if (claimed) return usable ? `Thank you, ${usable}` : 'Thank you'
  if (!live) return usable ? `Hello, ${usable}` : 'Hello'
  return usable ? `${usable}, choose your watch` : 'Choose your watch'
}

type Sort = 'suggested' | 'priceUp' | 'priceDown' | 'newest'

/** Below this many watches a filter rail is furniture, not help. */
const WORTH_FILTERING = 8

/**
 * What one person sees when they open their link.
 *
 * Not a shop, but not a different product either. The person reading this did
 * not come to buy a watch — their employer told them to pick one, and most of
 * them will never have chosen a watch before. So: their company's mark at the
 * top, what they have been given stated plainly, and the choice split in two
 * — what the award covers outright, and what it could go toward.
 *
 * It used to stop there, with no way through two hundred watches but
 * scrolling. Alex: "Filtering and layout dissapears for winners." The same
 * rail the portal has is here too once there is enough to warrant it, and it
 * filters both halves of the split at once, because somebody who wants a
 * 36mm Datejust wants to see both the ones they can have for nothing and the
 * ones they could put the award toward.
 *
 * Prices appear on a budget campaign and not on a shortlist. On a budget they
 * are the whole mechanic — you cannot spend an amount without seeing what
 * things cost. On a shortlist the employer has already chosen what is on
 * offer, so a price tag does two unhelpful things: it puts a number on a gift,
 * and it tells a few dozen employees what their company negotiated with us.
 */
export function RecipientChoice({ token, view }: { token: string; view: RecipientView }) {
  const [taking, setTaking] = useState<Choice | null>(null)
  const [filters, setFilters] = useState<FilterState>(NO_FILTERS)
  const [sort, setSort] = useState<Sort>('suggested')
  const { campaign, recipient } = view
  const showPrices = campaign.kind === 'BUDGET'
  const live = campaign.status === 'OPEN'

  const shown = useMemo(() => {
    const bands = { price: priceBands(view.choices), size: sizeBands(view.choices) }
    const kept = applyFilters(view.choices, filters, bands)
    const sorted = [...kept]
    /*
     * "Suggested" is the order the service already put them in: covered
     * first, then by the smallest amount left to pay. It is the only sort
     * here that knows about the award, so it is the default.
     */
    if (sort === 'priceUp') sorted.sort((a, b) => a.priceGbp - b.priceGbp)
    else if (sort === 'priceDown') sorted.sort((a, b) => b.priceGbp - a.priceGbp)
    else if (sort === 'newest') sorted.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    return sorted
  }, [view.choices, filters, sort])

  /*
   * Split once, here, rather than filtered twice in the markup.
   *
   * The service has already worked out what each watch leaves to pay, so this
   * is only where one list becomes two headings — and it happens after the
   * filtering, so both halves answer the same question.
   */
  const covered = shown.filter((item) => item.topUpGbp === 0)
  const topUp = shown.filter((item) => item.topUpGbp > 0)
  const allCovered = view.choices.filter((item) => item.topUpGbp === 0).length

  const sorts: Array<{ value: Sort; label: string }> = [
    { value: 'suggested', label: 'Suggested' },
    ...(showPrices
      ? [
        { value: 'priceUp' as Sort, label: 'Price, lowest first' },
        { value: 'priceDown' as Sort, label: 'Price, highest first' },
      ]
      : []),
    { value: 'newest', label: 'Newest first' },
  ]

  const filtering = live && !recipient.claimedAt && view.choices.length >= WORTH_FILTERING

  return (
    <main
      className="min-h-screen bg-white"
      style={{
        ['--brand' as string]: campaign.brandColor,
        ['--accent' as string]: campaign.accentColor,
      }}
    >
      <header className="border-b border-black/10 px-5 py-7 sm:px-8">
        <div className="mx-auto max-w-[1480px]">
          <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
            <div className="max-w-[620px]">
              {campaign.hasLogo ? (
                /* Their employer's mark, not ours. Somebody opening this has
                   been told by their own office to expect it, and a page
                   carrying a watch dealer's branding instead reads as a
                   mailshot. */
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={`/r/${token}/logo`} alt={campaign.partnerName} className="h-8 w-auto object-contain" />
              ) : (
                <p className="text-[12px] uppercase tracking-[0.1em] text-black/40">
                  {campaign.partnerName}
                </p>
              )}
              <h1 className="mt-2.5 font-serif text-[28px] leading-tight text-black sm:text-[32px]">
                {greeting(recipient.name, Boolean(recipient.claimedAt), live)}
              </h1>
              {campaign.intro && (
                <p className="mt-2.5 text-[14.5px] leading-relaxed text-black/60">
                  {campaign.intro}
                </p>
              )}
            </div>

            {!recipient.claimedAt && live && showPrices && campaign.budgetBase !== null && (
              /*
               * The award as a figure, not a sentence.
               *
               * It was three lines of prose in the middle of a paragraph, so
               * the one number this whole page turns on was the hardest thing
               * on it to find. Here it is set apart, with what it means for
               * the two groups below said underneath in one line.
               */
              <div className="border-l-2 pl-5" style={{ borderColor: 'var(--accent)' }}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-black/45">
                  Yours to put toward a watch
                </p>
                <p className="mt-1 font-serif text-[30px] leading-none tabular-nums text-black">
                  {money(campaign.budgetBase)}
                </p>
                <p className="mt-2 text-[12.5px] text-black/55">
                  {allCovered > 0
                    ? `${allCovered} ${allCovered === 1 ? 'watch is' : 'watches are'} yours for that alone`
                    : 'Add the difference on any watch below'}
                  {allCovered > 0 && view.choices.length > allCovered
                    ? ` · ${view.choices.length - allCovered} more if you add the difference`
                    : ''}
                </p>
              </div>
            )}
          </div>
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
        <>
          {filtering && (
            <FilterBar
              items={view.choices}
              state={filters}
              onChange={setFilters}
              resultCount={shown.length}
              total={view.choices.length}
            >
              <SortSelect value={sort} options={sorts} onChange={setSort} />
            </FilterBar>
          )}

          <div className="mx-auto flex max-w-[1480px] gap-8 px-5 py-7 sm:px-8">
            {filtering && <FilterRail items={view.choices} state={filters} onChange={setFilters} />}

            <div className="min-w-0 flex-1">
              {shown.length === 0 ? (
                <p className="py-20 text-center text-[14px] text-black/45">
                  Nothing matches that. Try a wider price band, or clear a filter.
                </p>
              ) : (
                <>
                  {/*
                    * What the award covers outright.
                    *
                    * Alex: "I like the split between what they can get and
                    * what they'd need to put money towards." It is the one
                    * thing on this page somebody has to understand, so each
                    * half says in a line what it is rather than relying on
                    * the prices underneath to explain themselves.
                    */}
                  {covered.length > 0 && (
                    <section>
                      {showPrices && (
                        <SectionHead
                          title="Yours for the award alone"
                          note="Nothing to pay. Choose one and it is set aside for you."
                          count={covered.length}
                        />
                      )}
                      <WatchGrid>
                        {covered.map((item) => (
                          <WatchCard
                            key={item.id}
                            title={describe(item)}
                            details={details(item)}
                            imageSrc={item.imageIds[0] ? `/r/${token}/image/${item.imageIds[0]}` : null}
                          >
                            {showPrices && (
                              /*
                               * The value, said to be covered.
                               *
                               * A bare price under "yours for the award alone"
                               * reads as something to pay, which is the
                               * opposite of what it is. Keeping the figure is
                               * worth it: somebody should see what they are
                               * being given is worth.
                               */
                              <>
                                <p className="text-[15px] font-semibold tabular-nums text-black">
                                  {money(item.priceGbp)}
                                </p>
                                <p className="text-[11.5px] text-black/45">covered by your award</p>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => setTaking(item)}
                              className="mt-2.5 h-10 w-full text-[12px] font-semibold uppercase tracking-[0.08em] text-white"
                              style={{ backgroundColor: 'var(--brand)' }}
                            >
                              Choose this one
                            </button>
                          </WatchCard>
                        ))}
                      </WatchGrid>
                    </section>
                  )}

                  {showPrices && topUp.length > 0 && (
                    <section className={covered.length > 0 ? 'mt-14 border-t border-black/10 pt-10' : ''}>
                      <SectionHead
                        title="Or put your award toward one of these"
                        note={`Your ${campaign.budgetBase !== null ? money(campaign.budgetBase) : 'award'} comes off each of these. The figure shown is what would be left for you to pay.`}
                        count={topUp.length}
                      />
                      <WatchGrid>
                        {topUp.map((item) => (
                          <WatchCard
                            key={item.id}
                            title={describe(item)}
                            details={details(item)}
                            imageSrc={item.imageIds[0] ? `/r/${token}/image/${item.imageIds[0]}` : null}
                          >
                            {/*
                              * The number that decides this, which is what is
                              * left to pay — not the price. The price is there
                              * underneath so nobody feels a figure has been
                              * kept from them.
                              */}
                            <p className="text-[15px] font-semibold tabular-nums text-black">
                              {money(item.topUpGbp)} to pay
                            </p>
                            <p className="text-[11.5px] tabular-nums text-black/45">
                              {money(item.priceGbp)} less your award
                            </p>
                            <button
                              type="button"
                              onClick={() => setTaking(item)}
                              className="mt-2.5 h-10 w-full border text-[12px] font-semibold uppercase tracking-[0.08em]"
                              style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}
                            >
                              Choose this one
                            </button>
                          </WatchCard>
                        ))}
                      </WatchGrid>
                    </section>
                  )}
                </>
              )}
            </div>
          </div>
        </>
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

/** A heading for half the split, with what it means said under it. */
function SectionHead({ title, note, count }: { title: string; note: string; count: number }) {
  return (
    <div className="mb-5">
      <h2 className="font-serif text-[20px] leading-snug text-black">
        {title}
        <span className="ml-2.5 align-middle text-[12px] font-sans tabular-nums text-black/35">
          {count}
        </span>
      </h2>
      <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-black/55">{note}</p>
    </div>
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
