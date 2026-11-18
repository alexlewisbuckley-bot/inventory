'use client'
import { useState } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { savePlanAction } from '@/app/actions/partner-programmes'
import { impliedDeal } from '@/lib/programme'
import { money } from './filters'
import type { AgentPlan as Plan } from '@/server/services/partner-programme-service'

/** What the agent types, before it becomes minor units. */
const toBase = (text: string) => {
  const digits = text.replace(/[^0-9.]/g, '')
  if (!digits) return null
  const value = Number(digits)
  return Number.isFinite(value) ? Math.round(value * 100) : null
}

/*
 * Grouped as they type.
 *
 * "3000000" and "300000" are one keystroke apart and look identical at a
 * glance; "3,000,000" and "300,000" do not. The figure being typed here is
 * somebody's year, and the commas are the only thing standing between a
 * missed nought and a target nobody noticed was wrong.
 */
const digitsOnly = (text: string) => text.replace(/[^0-9]/g, '')
const grouped = (digits: string) => (digits ? Number(digits).toLocaleString('en-US') : '')

const toWhole = (text: string) => {
  const digits = text.replace(/[^0-9]/g, '')
  return digits ? Number(digits) : null
}

/**
 * The start-of-year survey.
 *
 * Alex: "a survey feature for agents to set their targets at the start of the
 * year and have a plan against obtaining it."
 *
 * Four questions, which is as many as a salesperson will answer on a phone
 * between appointments, and each one earns its place:
 *
 *  - the figure, because that is the thing being asked for;
 *  - how many deals, because it turns the figure into arithmetic — "three
 *    million" is a feeling, "three million across ten deals" is three hundred
 *    thousand a deal, which is either last year's average or a conversation
 *    worth having in January rather than in November;
 *  - how, in their own words, because the plan is the point and a number
 *    with no plan behind it is a wish;
 *  - and what they need from us, because a target somebody sets alone is a
 *    target they carry alone.
 *
 * The implied figure is shown as they type rather than after they submit.
 * Finding out that your plan needs a 400,000 average on the screen where you
 * can still change it is the whole value of asking.
 */
export function AgentPlanForm({ token, plan, periodStart, onSaved }: {
  token: string
  plan: Plan | null
  periodStart: string
  onSaved: () => void
}) {
  const [target, setTarget] = useState(
    plan?.proposedTargetBase === null || plan?.proposedTargetBase === undefined
      ? ''
      : String(Math.round(plan.proposedTargetBase / 100)),
  )
  const [deals, setDeals] = useState(plan?.dealsTarget === null || plan?.dealsTarget === undefined ? '' : String(plan.dealsTarget))
  const [approach, setApproach] = useState(plan?.approach ?? '')
  const [support, setSupport] = useState(plan?.support ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const each = impliedDeal(toBase(target), toWhole(deals))

  const save = async () => {
    setBusy(true)
    const result = await savePlanAction(token, {
      proposedTargetBase: toBase(target),
      dealsTarget: toWhole(deals),
      approach: approach.trim() || null,
      support: support.trim() || null,
    })
    setBusy(false)
    setMessage(result.message)
    if (result.ok) onSaved()
  }

  return (
    <div className="max-w-[620px]">
      <p className="text-[14px] leading-relaxed text-black/60">
        Before the year gets going: what are you aiming at, and how do you mean to get there?
        Your company sees this — it is how they know what to back you with.
      </p>

      <label className="mt-5 block">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.09em] text-black/45">
          What you are aiming at
        </span>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[13px] text-black/40">AED</span>
          <input
            value={grouped(target)}
            onChange={(event) => setTarget(digitsOnly(event.target.value))}
            inputMode="numeric"
            placeholder="3,000,000"
            className="h-11 w-48 border border-black/15 px-3 text-right text-[15px] tabular-nums outline-none placeholder:text-black/25 focus:border-black/45"
          />
        </div>
      </label>

      <label className="mt-4 block">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.09em] text-black/45">
          In how many deals
        </span>
        <span className="mt-1.5 flex items-center gap-3">
          <input
            value={deals}
            onChange={(event) => setDeals(digitsOnly(event.target.value))}
            inputMode="numeric"
            placeholder="10"
            className="h-11 w-24 border border-black/15 px-3 text-right text-[15px] tabular-nums outline-none placeholder:text-black/25 focus:border-black/45"
          />
          {each !== null && (
            /* The arithmetic, while they can still do something about it. */
            <span className="text-[13px] text-black/55">{money(each)} a deal</span>
          )}
        </span>
      </label>

      <label className="mt-4 block">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.09em] text-black/45">
          How you will get there
        </span>
        <textarea
          value={approach}
          onChange={(event) => setApproach(event.target.value)}
          rows={4}
          placeholder="Referrals from the two developers I closed last year, and the Dubai Hills list."
          className="mt-1.5 w-full border border-black/15 p-3 text-[14px] leading-relaxed outline-none placeholder:text-black/25 focus:border-black/45"
        />
      </label>

      <label className="mt-4 block">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.09em] text-black/45">
          What you need from them
        </span>
        <textarea
          value={support}
          onChange={(event) => setSupport(event.target.value)}
          rows={3}
          placeholder="Two listing shoots a month, and cover on the Marina portfolio in Ramadan."
          className="mt-1.5 w-full border border-black/15 p-3 text-[14px] leading-relaxed outline-none placeholder:text-black/25 focus:border-black/45"
        />
      </label>

      <div className="mt-5 flex items-center gap-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="flex h-11 items-center gap-2 px-5 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-white disabled:opacity-60"
          style={{ backgroundColor: 'var(--brand)' }}
        >
          {plan?.submittedAt ? 'Save changes' : 'Set my year'}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
        {message && <p className="text-[12.5px] text-black/55">{message}</p>}
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-black/40">
        From {periodStart}. You can change this while the year is running — the figure only
        becomes your target when your company accepts it.
      </p>
    </div>
  )
}

/**
 * The plan once it is written, as the agent sees it.
 *
 * Shown rather than hidden behind an edit button: in March the question is
 * "what did I say I was going to do", and a form is a worse answer to that
 * than a sentence.
 */
export function AgentPlanSummary({ plan, onEdit, live }: {
  plan: Plan
  onEdit: () => void
  live: boolean
}) {
  const each = impliedDeal(plan.proposedTargetBase, plan.dealsTarget)

  return (
    <div className="max-w-[720px]">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        {plan.proposedTargetBase !== null && (
          <p className="font-serif text-[24px] leading-none tabular-nums text-black">
            {money(plan.proposedTargetBase)}
          </p>
        )}
        {plan.dealsTarget !== null && (
          <p className="text-[13px] text-black/55">
            in {plan.dealsTarget} {plan.dealsTarget === 1 ? 'deal' : 'deals'}
            {each !== null && ` · ${money(each)} each`}
          </p>
        )}
        {plan.acceptedAt && (
          <p className="flex items-center gap-1.5 text-[12.5px] text-black/55">
            <Check className="h-3.5 w-3.5" style={{ color: 'var(--accent)' }} aria-hidden />
            Accepted as your target
          </p>
        )}
      </div>

      {plan.approach && (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-black/40">
            How
          </p>
          <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-black/75">
            {plan.approach}
          </p>
        </div>
      )}
      {plan.support && (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-black/40">
            What you asked them for
          </p>
          <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-black/75">
            {plan.support}
          </p>
        </div>
      )}

      {live && (
        <button
          type="button"
          onClick={onEdit}
          className="mt-4 text-[12.5px] text-black/50 underline hover:text-black"
        >
          Change it
        </button>
      )}
    </div>
  )
}
