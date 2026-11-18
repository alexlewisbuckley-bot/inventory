'use client'
import { useState } from 'react'
import { saveProgrammeAction } from '@/app/actions/partner-programmes'
import { PROGRAMME_KINDS, PROGRAMME_KIND_HINTS, PROGRAMME_KIND_LABELS, type ProgrammeKind } from '@/lib/enums'

/** Whole currency units from a typed figure, in base minor units. */
function toBase(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, '')
  if (!cleaned) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

const YEAR = new Date().getFullYear()

/** Three rungs, prefilled, because an empty table teaches nobody the shape. */
const SUGGESTED = [
  { label: 'One', threshold: '1,000,000', cap: '25,000' },
  { label: 'Two', threshold: '2,000,000', cap: '50,000' },
  { label: 'Three', threshold: '3,000,000', cap: '95,000' },
]

/**
 * Starting a year's incentive.
 *
 * The two shapes Alex asked for, chosen by the company rather than by us:
 * rungs that unlock more as they go, or one figure each with one prize
 * against it. The rungs come prefilled with a plausible ladder — an empty
 * three-column table is a puzzle, and a worked example is a sentence.
 */
export function ProgrammeStart({ token }: { token: string }) {
  const [kind, setKind] = useState<ProgrammeKind>('LADDER')
  const [name, setName] = useState(`${YEAR} incentive`)
  const [intro, setIntro] = useState('')
  const [start, setStart] = useState(`${YEAR}-01-01`)
  const [end, setEnd] = useState(`${YEAR}-12-31`)
  const [rows, setRows] = useState(SUGGESTED)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const edit = (index: number, field: 'label' | 'threshold' | 'cap') => (value: string) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, [field]: value } : row)))

  const submit = async () => {
    setBusy(true)
    setProblem(null)
    /*
     * A single-target programme still writes one rung, and that rung is
     * what the prize may be worth. The threshold is each agent's own figure
     * and is set on their row, so it is zero here and the service swaps it
     * for the agent's target when it builds their ladder.
     */
    const tiers = kind === 'LADDER'
      ? rows
        .map((row) => ({
          label: row.label.trim() || 'Rung',
          thresholdBase: toBase(row.threshold) ?? 0,
          rewardCapBase: toBase(row.cap) ?? 0,
        }))
        .filter((tier) => tier.thresholdBase > 0)
      : [{
        label: 'Target',
        thresholdBase: 0,
        rewardCapBase: toBase(rows[0]?.cap ?? '') ?? 0,
      }]

    const result = await saveProgrammeAction(token, {
      name, kind, intro: intro.trim() || null, periodStart: start, periodEnd: end, tiers,
    })
    setBusy(false)
    if (!result.ok) { setProblem(result.message); return }
    window.location.reload()
  }

  return (
    <div className="mx-auto max-w-[720px] px-5 py-10 sm:px-8">
      <h1 className="font-serif text-[26px] leading-tight text-black">Start an incentive</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-black/60">
        Add the people it is for, give each of them a figure to reach, and keep the figure
        current as the year goes on. Everyone gets their own link showing where they are and
        what they are working toward.
      </p>

      <fieldset className="mt-7">
        <legend className="text-[11px] font-semibold uppercase tracking-[0.09em] text-black/45">
          How it works
        </legend>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
          {PROGRAMME_KINDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setKind(option)}
              aria-pressed={kind === option}
              className={`border p-3.5 text-left transition-colors ${
                kind === option ? 'border-black bg-black/[0.03]' : 'border-black/12 hover:border-black/35'
              }`}
            >
              <span className="block text-[14px] font-semibold text-black">
                {PROGRAMME_KIND_LABELS[option]}
              </span>
              <span className="mt-1 block text-[12.5px] leading-relaxed text-black/55">
                {PROGRAMME_KIND_HINTS[option]}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[11px] uppercase tracking-[0.07em] text-black/45">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-11 border border-black/15 px-3 text-[14px] outline-none focus:border-black/45"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.07em] text-black/45">Starts</span>
          <input
            type="date" value={start} onChange={(event) => setStart(event.target.value)}
            className="h-11 border border-black/15 px-3 text-[14px] outline-none focus:border-black/45"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.07em] text-black/45">Ends</span>
          <input
            type="date" value={end} onChange={(event) => setEnd(event.target.value)}
            className="h-11 border border-black/15 px-3 text-[14px] outline-none focus:border-black/45"
          />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[11px] uppercase tracking-[0.07em] text-black/45">
            What your people read at the top of their page (optional)
          </span>
          <textarea
            value={intro}
            onChange={(event) => setIntro(event.target.value)}
            rows={2}
            className="border border-black/15 px-3 py-2 text-[14px] outline-none focus:border-black/45"
          />
        </label>
      </div>

      <div className="mt-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-black/45">
          {kind === 'LADDER' ? 'The rungs' : 'The prize'}
        </p>
        <p className="mt-1 text-[12.5px] text-black/55">
          {kind === 'LADDER'
            ? 'Reach the figure on the left, choose a watch worth up to the figure on the right.'
            : 'Each person’s own target is set on their row. This is the most their watch may be worth.'}
        </p>
        <div className="mt-2.5 space-y-2">
          {(kind === 'LADDER' ? rows : rows.slice(0, 1)).map((row, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2">
              {kind === 'LADDER' && (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-black/45">Called</span>
                    <input
                      value={row.label}
                      onChange={(event) => edit(index, 'label')(event.target.value)}
                      className="h-10 w-28 border border-black/15 px-2 text-[13.5px] outline-none focus:border-black/45"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-black/45">Reach</span>
                    <input
                      value={row.threshold}
                      onChange={(event) => edit(index, 'threshold')(event.target.value)}
                      inputMode="numeric"
                      className="h-10 w-36 border border-black/15 px-2 text-right text-[13.5px] tabular-nums outline-none focus:border-black/45"
                    />
                  </label>
                </>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-black/45">Unlocks up to</span>
                <input
                  value={row.cap}
                  onChange={(event) => edit(index, 'cap')(event.target.value)}
                  inputMode="numeric"
                  className="h-10 w-36 border border-black/15 px-2 text-right text-[13.5px] tabular-nums outline-none focus:border-black/45"
                />
              </label>
            </div>
          ))}
        </div>
        {kind === 'LADDER' && (
          <button
            type="button"
            onClick={() => setRows((current) => [...current, { label: '', threshold: '', cap: '' }])}
            className="mt-2 text-[12.5px] text-black/55 underline underline-offset-2 hover:text-black"
          >
            Add a rung
          </button>
        )}
      </div>

      {problem && <p role="alert" className="mt-4 text-[13px] text-[#b42318]">{problem}</p>}

      <button
        type="button"
        disabled={busy || !name.trim()}
        onClick={() => void submit()}
        className="mt-7 h-11 px-6 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-white disabled:opacity-50"
        style={{ backgroundColor: 'var(--brand)' }}
      >
        {busy ? 'Setting it up…' : 'Create it'}
      </button>
    </div>
  )
}
