'use client'
import { useState } from 'react'
import { Check, Copy, Plus, TrendingUp } from 'lucide-react'
import {
  addAgentAction, enrolAgentAction, recordProgressAction,
  setProgrammeStatusAction, setTargetAction,
} from '@/app/actions/partner-programmes'
import { money } from './filters'
import { PROGRAMME_KIND_LABELS, type ProgrammeKind, type ProgrammeStatus } from '@/lib/enums'

/** Mirrors the service's `AgentRow`, serialised for the client. */
export interface AgentCard {
  agentId: string
  goalId: string | null
  name: string
  email: string | null
  /** Null for somebody who has never been given a link. */
  token: string | null
  targetBase: number | null
  earnedBase: number
  asOf: string | null
  reachedLabel: string | null
  nextLabel: string | null
  toGo: number | null
  fraction: number
  capBase: number
  pickedLabel: string | null
  pickedNote: string | null
}

export interface ProgrammeBoardData {
  id: string
  name: string
  kind: ProgrammeKind
  status: ProgrammeStatus
  periodStart: string
  periodEnd: string
  tiers: Array<{ id: string; label: string; thresholdBase: number; rewardCapBase: number }>
  agents: AgentCard[]
}

/** Whole currency units from a typed figure, in base minor units. */
function toBase(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, '')
  if (!cleaned) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

const today = () => new Date().toISOString().slice(0, 10)

/**
 * The company's own view of its people and where they have got to.
 *
 * Alex: "a place the company can add their agents to the portal and assign a
 * goal against them or a target that is tracked."
 *
 * Built around the one thing that has to happen every month — somebody
 * sitting down and typing in a dozen figures. So the figure is the first
 * control on every row and takes a number and a date and nothing else; the
 * rest of a person's row is what that figure bought them, which is the part
 * worth reading rather than filling in.
 */
export function ProgrammeBoard({ token, data }: { token: string; data: ProgrammeBoardData }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [byName, setByName] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const run = async (work: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(true)
    const result = await work()
    setBusy(false)
    setNote(result.message)
    if (result.ok) window.location.reload()
  }

  const copy = async (agentToken: string | null) => {
    if (!agentToken) return
    await navigator.clipboard?.writeText(`${window.location.origin}/a/${agentToken}`)
    setCopied(agentToken)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-7 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-black/10 pb-5">
        {/* The programme's name is in the page header above; this is the rest of it. */}
        <p className="text-[13px] text-black/55">
          {PROGRAMME_KIND_LABELS[data.kind]} · {data.periodStart} to {data.periodEnd}
        </p>
        <div className="flex items-center gap-3">
          <span className={`text-[12px] uppercase tracking-[0.08em] ${
            data.status === 'OPEN' ? 'text-black' : 'text-black/40'
          }`}>
            {data.status === 'OPEN' ? 'Running' : data.status === 'DRAFT' ? 'Not started' : 'Finished'}
          </span>
          {data.status !== 'OPEN' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => setProgrammeStatusAction(token, data.id, 'OPEN'))}
              className="h-9 border border-black px-4 text-[12px] font-semibold uppercase tracking-[0.08em]"
            >
              Start it
            </button>
          )}
          {data.status === 'OPEN' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => setProgrammeStatusAction(token, data.id, 'CLOSED'))}
              className="h-9 border border-black/20 px-4 text-[12px] uppercase tracking-[0.08em] text-black/60"
            >
              Close it
            </button>
          )}
        </div>
      </header>

      {data.tiers.length > 0 && (
        /*
         * The ladder, said once at the top.
         *
         * Repeating it on every row would be the same four facts a dozen
         * times; saying it nowhere leaves "reached Two" meaning nothing to
         * somebody who did not set the programme up.
         */
        <section className="mt-5 flex flex-wrap gap-2">
          {data.tiers.map((tier) => (
            <div key={tier.id} className="border border-black/12 px-3.5 py-2">
              <p className="text-[11px] uppercase tracking-[0.08em] text-black/45">{tier.label}</p>
              <p className="mt-0.5 text-[14px] font-semibold tabular-nums text-black">
                {money(tier.thresholdBase)}
              </p>
              <p className="text-[11.5px] text-black/50">unlocks up to {money(tier.rewardCapBase)}</p>
            </div>
          ))}
        </section>
      )}

      {note && <p className="mt-4 text-[13px] text-black/70">{note}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-black/50">
          {data.agents.length} {data.agents.length === 1 ? 'person' : 'people'}
        </h2>
        <button
          type="button"
          onClick={() => setAdding((open) => !open)}
          className="flex items-center gap-1.5 text-[13px] font-semibold text-black hover:underline"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add someone
        </button>
        {/*
          Who is at the keyboard, asked once rather than per row.

          The portal has one passphrase for the whole company, so "the
          partner" is not a person. A figure that nobody signed is a figure
          nobody can ask about in March.
        */}
        <label className="ml-auto flex items-center gap-2 text-[12.5px] text-black/55">
          Updates by
          <input
            value={byName}
            onChange={(event) => setByName(event.target.value)}
            placeholder="your name"
            className="h-8 w-32 border border-black/12 px-2 text-[13px] text-black outline-none focus:border-black/40"
          />
        </label>
      </div>

      {adding && (
        <AddAgent
          busy={busy}
          single={data.kind === 'SINGLE'}
          onAdd={(input) => run(() => addAgentAction(token, data.id, input))}
        />
      )}

      <ul className="mt-4 divide-y divide-black/8 border-y border-black/8">
        {data.agents.map((agent) => (
          <AgentRowView
            key={agent.agentId}
            agent={agent}
            single={data.kind === 'SINGLE'}
            busy={busy}
            copied={copied === agent.token}
            onCopy={() => copy(agent.token)}
            onTarget={(targetBase) => agent.goalId
              && run(() => setTargetAction(token, data.id, agent.goalId!, targetBase))}
            onRecord={(asOf, amountBase) => agent.goalId
              && run(() => recordProgressAction(token, data.id, {
                goalId: agent.goalId!, asOf, amountBase, note: null, byName: byName || null,
              }))}
            onEnrol={() => run(() => enrolAgentAction(token, data.id, agent.agentId))}
          />
        ))}
      </ul>

      {data.agents.length === 0 && (
        <p className="py-10 text-center text-[14px] text-black/45">
          Nobody on this programme yet. Add the people it is for and each one gets their own link.
        </p>
      )}
    </div>
  )
}

function AddAgent({ busy, single, onAdd }: {
  busy: boolean
  single: boolean
  onAdd: (input: { name: string; email: string | null; targetBase: number | null }) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [target, setTarget] = useState('')

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border border-black/10 bg-black/[0.02] p-3">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.07em] text-black/45">Name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-9 w-44 border border-black/15 px-2 text-[13.5px] outline-none focus:border-black/45"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.07em] text-black/45">Email (optional)</span>
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-9 w-52 border border-black/15 px-2 text-[13.5px] outline-none focus:border-black/45"
        />
      </label>
      {single && (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.07em] text-black/45">Their target</span>
          <input
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            inputMode="numeric"
            placeholder="3,000,000"
            className="h-9 w-36 border border-black/15 px-2 text-right text-[13.5px] tabular-nums outline-none focus:border-black/45"
          />
        </label>
      )}
      <button
        type="button"
        disabled={busy || !name.trim()}
        onClick={() => onAdd({
          name,
          email: email.trim() || null,
          targetBase: single ? toBase(target) : null,
        })}
        className="h-9 bg-black px-4 text-[12px] font-semibold uppercase tracking-[0.08em] text-white disabled:opacity-50"
      >
        Add
      </button>
    </div>
  )
}

function AgentRowView({ agent, single, busy, copied, onCopy, onTarget, onRecord, onEnrol }: {
  agent: AgentCard
  single: boolean
  busy: boolean
  copied: boolean
  onCopy: () => void
  onTarget: (targetBase: number | null) => void
  onRecord: (asOf: string, amountBase: number) => void
  onEnrol: () => void
}) {
  const [figure, setFigure] = useState('')
  const [asOf, setAsOf] = useState(today())
  const [target, setTarget] = useState(
    agent.targetBase === null ? '' : String(Math.round(agent.targetBase / 100)),
  )

  /*
   * Somebody at the company who is not on this programme.
   *
   * The team list is shared with the leaderboards, so this board shows
   * everybody who works there — which is right, because that is how you put
   * one of them on the scheme. What is not right is showing them a target box
   * and a figure box when there is no goal for either to be saved against:
   * every one of those buttons would be a tick that does nothing. One button
   * instead, and the rest of the row appears once they are on it.
   */
  if (agent.goalId === null) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4">
        <div className="min-w-[200px]">
          <p className="text-[15px] font-semibold text-black/70">{agent.name}</p>
          {agent.email && <p className="text-[12px] text-black/40">{agent.email}</p>}
        </div>
        <p className="text-[12.5px] text-black/45">Not on this programme</p>
        <button
          type="button"
          disabled={busy}
          onClick={onEnrol}
          className="h-9 border border-black/15 px-3 text-[12.5px] text-black/70 hover:border-black/40 hover:text-black disabled:opacity-50"
        >
          Add to this programme
        </button>
      </li>
    )
  }

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-[200px]">
          <p className="text-[15px] font-semibold text-black">{agent.name}</p>
          {agent.email && <p className="text-[12px] text-black/45">{agent.email}</p>}
          {/* Somebody added for a leaderboard has no link until they are put
              on a programme, and a button that copies nothing is worse than
              no button. */}
          {agent.token ? (
            <button
              type="button"
              onClick={onCopy}
              className="mt-1 flex items-center gap-1.5 text-[12px] text-black/50 hover:text-black"
            >
              {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
              {copied ? 'Link copied' : 'Copy their link'}
            </button>
          ) : (
            <p className="mt-1 text-[12px] text-black/35">No link yet</p>
          )}
        </div>

        <div className="min-w-[220px] flex-1">
          <p className="text-[14px] tabular-nums text-black">
            <span className="font-semibold">{money(agent.earnedBase)}</span>
            {agent.asOf && <span className="ml-2 text-[12px] text-black/45">as at {agent.asOf}</span>}
          </p>
          {/* The bar fills across the rung being climbed, not from zero —
              otherwise it reads as 83% for most of a year. */}
          <div className="mt-1.5 h-1.5 w-full bg-black/8" role="presentation">
            <div className="h-full bg-black" style={{ width: `${Math.round(agent.fraction * 100)}%` }} />
          </div>
          <p className="mt-1 text-[12px] text-black/55">
            {agent.reachedLabel
              ? `${agent.reachedLabel} reached · may choose up to ${money(agent.capBase)}`
              : 'Nothing unlocked yet'}
            {agent.toGo !== null && agent.nextLabel
              ? ` · ${money(agent.toGo)} to ${agent.nextLabel}`
              : ''}
          </p>
          {agent.pickedLabel && (
            <p className="mt-1 text-[12px] text-black/55">Working toward {agent.pickedLabel}</p>
          )}
          {!agent.pickedLabel && agent.pickedNote && (
            <p className="mt-1 text-[12px] text-black/55">Asked for: {agent.pickedNote}</p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {single && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.07em] text-black/45">Target</span>
              <div className="flex items-center gap-1">
                <input
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  inputMode="numeric"
                  className="h-9 w-32 border border-black/15 px-2 text-right text-[13px] tabular-nums outline-none focus:border-black/45"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onTarget(toBase(target))}
                  className="h-9 border border-black/15 px-2.5 text-[12px] text-black/60 hover:border-black/40 hover:text-black"
                >
                  Set
                </button>
              </div>
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.07em] text-black/45">As at</span>
            <input
              type="date"
              value={asOf}
              onChange={(event) => setAsOf(event.target.value)}
              className="h-9 border border-black/15 px-2 text-[13px] outline-none focus:border-black/45"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.07em] text-black/45">Earned so far</span>
            <div className="flex items-center gap-1">
              <input
                value={figure}
                onChange={(event) => setFigure(event.target.value)}
                inputMode="numeric"
                placeholder="2,500,000"
                className="h-9 w-36 border border-black/15 px-2 text-right text-[13px] tabular-nums outline-none focus:border-black/45"
              />
              <button
                type="button"
                disabled={busy || toBase(figure) === null}
                onClick={() => {
                  const amount = toBase(figure)
                  if (amount !== null) onRecord(asOf, amount)
                }}
                className="flex h-9 items-center gap-1.5 bg-black px-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-white disabled:opacity-40"
              >
                <TrendingUp className="h-3.5 w-3.5" aria-hidden /> Record
              </button>
            </div>
          </label>
        </div>
      </div>
    </li>
  )
}
