'use client'
import { useState } from 'react'
import { Check, Lock } from 'lucide-react'
import { pickRewardAction } from '@/app/actions/partner-programmes'
import { AgentPlanForm, AgentPlanSummary } from './AgentPlan'
import { money } from './filters'
import { WatchCard, WatchGrid } from './WatchCard'
import type { AgentView } from '@/server/services/partner-programme-service'
import type { AgentChoice } from '@/server/services/partner-programme-stock'

const describe = (item: { brandName: string; model: string | null; modelName: string | null }) =>
  [item.brandName, item.model, item.modelName].filter(Boolean).join(' ')

/**
 * One agent's year.
 *
 * Not a shop and not a dashboard. The person reading this is a salesperson
 * between appointments looking at a phone, and there are exactly two things
 * they came for: how far along am I, and what am I getting. Everything else
 * on the page is in service of those two.
 *
 * The ladder is the spine of it — Alex: "the agent if x Million AED earnt
 * unlocks x incetive or watch" — so every rung is shown, reached or not,
 * with what it is worth. A rung you have not made is the reason to keep
 * going, and hiding it would leave the page saying only what has already
 * happened.
 */
export function AgentProgress({ token, view, choices }: {
  token: string
  view: AgentView
  choices: AgentChoice[]
}) {
  const [picking, setPicking] = useState(false)
  const [note, setNote] = useState(view.picked.note ?? '')
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingPlan, setEditingPlan] = useState(false)

  const live = view.status === 'OPEN'
  /*
   * Whether they have answered the survey.
   *
   * Unanswered and the year running, it is the first thing on the page: the
   * figure underneath is nought in January and a page that leads with nought
   * is a page that says nothing. Answered, it moves below what they are
   * working toward, where in March it reads as "this is what I said I would
   * do" rather than as a form to fill in again.
   */
  const planned = view.plan?.submittedAt != null && !editingPlan

  const choose = async (watchId: string | null) => {
    setBusy(true)
    const result = await pickRewardAction(token, { watchId, note: note.trim() || null })
    setBusy(false)
    setSaved(result.message)
    if (result.ok) window.location.reload()
  }

  return (
    <main
      className="min-h-screen bg-white"
      style={{
        ['--brand' as string]: view.brandColor,
        ['--accent' as string]: view.accentColor,
      }}
    >
      <header className="border-b border-black/10 px-5 py-7 sm:px-8">
        <div className="mx-auto max-w-[1180px]">
          {view.hasLogo ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={`/a/${token}/logo`} alt={view.partnerName} className="h-8 w-auto object-contain" />
          ) : (
            <p className="text-[12px] uppercase tracking-[0.1em] text-black/40">{view.partnerName}</p>
          )}
          <h1 className="mt-2.5 font-serif text-[28px] leading-tight text-black sm:text-[32px]">
            {view.agentName}
          </h1>
          <p className="mt-1 text-[13px] text-black/50">
            {view.programmeName} · {view.periodStart} to {view.periodEnd}
            {!live && ' · finished'}
          </p>
          {view.intro && (
            <p className="mt-3 max-w-[620px] text-[14.5px] leading-relaxed text-black/60">{view.intro}</p>
          )}
        </div>
      </header>

      {live && !planned && (
        <section id="plan" className="border-b border-black/10 px-5 py-7 sm:px-8">
          <div className="mx-auto max-w-[1180px]">
            <h2 className="font-serif text-[22px] leading-tight text-black">
              {view.plan?.submittedAt ? 'Your plan for the year' : 'Set your year'}
            </h2>
            <div className="mt-3">
              <AgentPlanForm
                token={token}
                plan={view.plan}
                periodStart={view.periodStart}
                onSaved={() => window.location.reload()}
              />
            </div>
          </div>
        </section>
      )}

      <section className="border-b border-black/10 px-5 py-7 sm:px-8">
        <div className="mx-auto max-w-[1180px]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-black/45">
            Earned so far
          </p>
          <p className="mt-1.5 font-serif text-[40px] leading-none tabular-nums text-black">
            {money(view.earnedBase)}
          </p>
          <p className="mt-2 text-[12.5px] text-black/50">
            {view.asOf
              ? `As at ${view.asOf}, from ${view.partnerName}.`
              : `${view.partnerName} has not recorded a figure yet.`}
          </p>

          {view.standing.next && view.standing.toGo !== null && (
            <div className="mt-5 max-w-[520px]">
              <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="text-black/55">
                  {view.standing.reached ? `Past ${view.standing.reached.label}` : 'On your way'}
                </span>
                <span className="font-semibold tabular-nums text-black">
                  {money(view.standing.toGo)} to {view.standing.next.label}
                </span>
              </div>
              {/* Across the rung being climbed, not from zero: from zero this
                  reads as 83% for most of a year and stops meaning anything. */}
              <div className="mt-1.5 h-2 w-full bg-black/8" role="presentation">
                <div
                  className="h-full"
                  style={{
                    width: `${Math.round(view.standing.fraction * 100)}%`,
                    backgroundColor: 'var(--brand)',
                  }}
                />
              </div>
            </div>
          )}

          {view.standing.rungs.length > 0 && (
            <ul className="mt-6 flex flex-wrap gap-2.5">
              {view.standing.rungs.map((rung) => (
                <li
                  key={rung.id}
                  className={`border px-4 py-2.5 ${
                    rung.reached ? 'border-transparent bg-black/[0.04]' : 'border-black/12'
                  }`}
                >
                  <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-black/45">
                    {rung.reached
                      ? <Check className="h-3 w-3" style={{ color: 'var(--accent)' }} aria-hidden />
                      : <Lock className="h-3 w-3 text-black/30" aria-hidden />}
                    {rung.label}
                  </p>
                  <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-black">
                    {money(rung.thresholdBase)}
                  </p>
                  <p className="text-[11.5px] text-black/50">
                    {rung.reached ? 'unlocked' : 'unlocks'} a watch up to {money(rung.rewardCapBase)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-[1180px] px-5 py-7 sm:px-8">
        {/*
          What they are working toward, before what they could pick.

          The thing somebody came back to see is the watch with their name
          against it, not a grid they have already been through.
        */}
        <section className="border-b border-black/10 pb-6">
          <h2 className="font-serif text-[20px] text-black">What you are working toward</h2>
          {view.picked.label ? (
            <p className="mt-2 text-[15px] text-black">
              <span className="font-semibold">{view.picked.label}</span>
              {view.picked.note && <span className="text-black/55"> — {view.picked.note}</span>}
            </p>
          ) : view.picked.note ? (
            <p className="mt-2 text-[15px] text-black/75">{view.picked.note}</p>
          ) : (
            <p className="mt-2 text-[14px] text-black/55">
              You have not said yet. Pick something below, or write down what you would want.
            </p>
          )}

          {live && (
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <label className="flex min-w-[260px] flex-1 flex-col gap-1">
                <span className="text-[11px] uppercase tracking-[0.07em] text-black/45">
                  Or say it in your own words
                </span>
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="A steel Daytona, white dial if you can find one"
                  className="h-11 border border-black/15 px-3 text-[14px] outline-none placeholder:text-black/30 focus:border-black/45"
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => void choose(view.picked.watchId)}
                className="h-11 border border-black/20 px-4 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-black/70 hover:border-black"
              >
                Save that
              </button>
            </div>
          )}
          {saved && <p className="mt-2 text-[12.5px] text-black/55">{saved}</p>}
        </section>

        {planned && view.plan && (
          <section className="border-b border-black/10 py-6">
            <h2 className="font-serif text-[20px] text-black">Your plan for the year</h2>
            <div className="mt-3">
              <AgentPlanSummary
                plan={view.plan}
                live={live}
                /* The form is at the top of the page, so take them to it —
                   otherwise "Change it" looks like it did nothing. */
                onEdit={() => {
                  setEditingPlan(true)
                  requestAnimationFrame(() => {
                    document.getElementById('plan')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  })
                }}
              />
            </div>
          </section>
        )}

        {live && view.standing.capBase > 0 && (
          <section className="pt-6">
            <h2 className="font-serif text-[20px] text-black">
              Yours to choose from
              <span className="ml-2.5 align-middle font-sans text-[12px] tabular-nums text-black/35">
                {choices.length}
              </span>
            </h2>
            <p className="mt-1 max-w-[620px] text-[13px] leading-relaxed text-black/55">
              Everything here is within the {money(view.standing.capBase)} you have unlocked.
              Choosing one does not hold it — it tells {view.partnerName} what you are aiming at.
            </p>

            {choices.length === 0 ? (
              <p className="py-10 text-[14px] text-black/45">
                Nothing in the case is within that just now. Write down what you want above and
                they will look for it.
              </p>
            ) : (
              <div className="mt-5">
                <WatchGrid>
                  {choices.map((item) => (
                    <WatchCard
                      key={item.id}
                      title={describe(item)}
                      details={[item.year, item.caseSizeMm ? `${item.caseSizeMm}mm` : null, item.dial]
                        .filter(Boolean).join(' · ')}
                      imageSrc={item.imageIds[0] ? `/a/${token}/image/${item.imageIds[0]}` : null}
                      selected={view.picked.watchId === item.id}
                    >
                      <p className="text-[14px] font-semibold tabular-nums text-black">
                        {money(item.priceBase)}
                      </p>
                      <button
                        type="button"
                        disabled={busy || picking}
                        onClick={() => { setPicking(true); void choose(item.id) }}
                        className={`mt-2.5 h-10 w-full text-[12px] font-semibold uppercase tracking-[0.08em] ${
                          view.picked.watchId === item.id ? 'text-white' : 'border'
                        }`}
                        style={view.picked.watchId === item.id
                          ? { backgroundColor: 'var(--brand)' }
                          : { borderColor: 'var(--brand)', color: 'var(--brand)' }}
                      >
                        {view.picked.watchId === item.id ? 'This one' : 'I want this'}
                      </button>
                    </WatchCard>
                  ))}
                </WatchGrid>
              </div>
            )}
          </section>
        )}

        {live && view.standing.capBase === 0 && (
          <section className="pt-6">
            <p className="max-w-[620px] text-[14px] leading-relaxed text-black/55">
              {view.standing.next
                ? `Nothing is unlocked yet. ${money(view.standing.toGo ?? 0)} more and ${view.standing.next.label} opens, which is a watch up to ${money(view.standing.next.rewardCapBase)}.`
                : `${view.partnerName} has not set the rungs for this one yet.`}
            </p>
          </section>
        )}

        {view.history.length > 1 && (
          /*
            The figures behind the number at the top.

            A single number asks to be taken on trust. The log is what makes
            it somebody's year rather than an assertion, and it is the first
            thing an agent who thinks the number is wrong will look at.
          */
          <section className="mt-8 border-t border-black/10 pt-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-black/45">
              How it has moved
            </h2>
            <ul className="mt-2.5 space-y-1">
              {view.history.map((entry) => (
                <li key={entry.asOf} className="flex items-baseline gap-3 text-[13px]">
                  <span className="w-24 shrink-0 tabular-nums text-black/45">{entry.asOf}</span>
                  <span className="font-semibold tabular-nums text-black">{money(entry.amountBase)}</span>
                  {entry.note && <span className="text-black/50">{entry.note}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  )
}
