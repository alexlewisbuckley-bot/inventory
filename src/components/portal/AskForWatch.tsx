'use client'
import { useState } from 'react'
import { Search, Check } from 'lucide-react'
import { askFromAgentAction, askFromPortalAction } from '@/app/actions/sourcing-requests'
import { ui } from './ui'

/**
 * "We do not have it — ask us to find it."
 *
 * Alex: "We also need to add a sourcing request CTA that is easily visable for
 * agents and procurers in case we don't have the exact watch or item they are
 * looking for."
 *
 * The moment this is for is the one where somebody has been through the whole
 * case and not found the thing they came for. That moment currently ends with
 * them closing the tab, and the ask — which is the most valuable thing they
 * could tell us — never reaches the board where we would act on it.
 *
 * So: one line to say what they want, shut until they ask for it. A form
 * sitting open under every stock list is a form people scroll past; a button
 * that says what it does is one they press when the moment comes. Only the
 * words are required. A reference number and a budget help and are not worth
 * losing the ask over — we can ask the rest when we call them.
 */
export function AskForWatch({ token, as, compact = false }: {
  token: string
  /** Which door this is behind: the company's portal, or an agent's own link. */
  as: 'portal' | 'agent'
  /** Inline on a page that already has a heading above it. */
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [wanted, setWanted] = useState('')
  const [reference, setReference] = useState('')
  const [budget, setBudget] = useState('')
  const [notes, setNotes] = useState('')
  const [who, setWho] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const send = async () => {
    setBusy(true)
    const input = {
      wanted: wanted.trim(),
      referenceNo: reference.trim() || null,
      budgetBase: budget.replace(/[^0-9]/g, '') ? Number(budget.replace(/[^0-9]/g, '')) * 100 : null,
      notes: notes.trim() || null,
      // The portal's passphrase belongs to a company, not a person, so the
      // name is asked for there. An agent's link already knows who they are.
      askedByName: as === 'portal' ? who.trim() || null : null,
    }
    const result = as === 'portal'
      ? await askFromPortalAction(token, input)
      : await askFromAgentAction(token, input)
    setBusy(false)
    if (result.ok) {
      setDone(result.message)
      setWanted('')
      setReference('')
      setBudget('')
      setNotes('')
      setOpen(false)
    } else {
      setDone(result.message)
    }
  }

  if (!open) {
    return (
      <div className={compact ? '' : 'border-t border-black/10 py-7'}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={() => { setOpen(true); setDone(null) }}
            className="flex h-11 items-center gap-2 border px-4 text-[12.5px] font-semibold uppercase tracking-[0.08em]"
            style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}
          >
            <Search className="h-3.5 w-3.5" aria-hidden />
            Ask us to find one
          </button>
          <p className="max-w-[460px] text-[13px] leading-relaxed text-black/55">
            Not in the case? Tell us what you are after and we will go and look for it.
          </p>
        </div>
        {done && (
          <p className="mt-3 flex items-center gap-2 text-[13px] text-black/70">
            <Check className="h-3.5 w-3.5" style={{ color: 'var(--accent)' }} aria-hidden />
            {done}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className={compact ? '' : 'border-t border-black/10 py-7'}>
      <div className="max-w-[620px]">
        <h3 className="font-serif text-[20px] text-black">What are you looking for?</h3>

        <label className="mt-4 block">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.09em] text-black/45">
            The watch
          </span>
          <input
            value={wanted}
            onChange={(event) => setWanted(event.target.value)}
            placeholder="Rolex Daytona 126500LN, white dial"
            autoFocus
            className="mt-1.5 h-11 w-full border border-black/15 px-3 text-[14.5px] outline-none placeholder:text-black/25 focus:border-black/45"
          />
        </label>

        <div className="mt-4 flex flex-wrap gap-4">
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.09em] text-black/45">
              Reference, if you know it
            </span>
            <input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="126500LN"
              className="mt-1.5 h-11 w-44 border border-black/15 px-3 text-[14px] outline-none placeholder:text-black/25 focus:border-black/45"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.09em] text-black/45">
              Up to (AED)
            </span>
            <input
              value={budget}
              onChange={(event) => setBudget(event.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              placeholder="150,000"
              className="mt-1.5 h-11 w-44 border border-black/15 px-3 text-right text-[14px] tabular-nums outline-none placeholder:text-black/25 focus:border-black/45"
            />
          </label>
          {as === 'portal' && (
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.09em] text-black/45">
                Your name
              </span>
              <input
                value={who}
                onChange={(event) => setWho(event.target.value)}
                placeholder="who to come back to"
                className="mt-1.5 h-11 w-52 border border-black/15 px-3 text-[14px] outline-none placeholder:text-black/25 focus:border-black/45"
              />
            </label>
          )}
        </div>

        <label className="mt-4 block">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.09em] text-black/45">
            Anything else
          </span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="Needed before the end of March. Box and papers, and it has to be unworn."
            className="mt-1.5 w-full border border-black/15 p-3 text-[14px] leading-relaxed outline-none placeholder:text-black/25 focus:border-black/45"
          />
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || wanted.trim().length === 0}
            onClick={() => void send()}
            className="h-11 px-5 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            Send it to us
          </button>
          <button type="button" onClick={() => setOpen(false)} className={ui.ghost}>
            Never mind
          </button>
          {done && <p className="text-[12.5px] text-black/55">{done}</p>}
        </div>
      </div>
    </div>
  )
}

/**
 * What they have already asked for, and where it has got to.
 *
 * Without this the CTA is a form that swallows things. "We are looking" is
 * the answer to the question pressing the button asks, and showing it is also
 * what stops the same ask arriving three times by email.
 */
export function AsksSoFar({ rows, heading = 'What you have asked us to find' }: {
  rows: Array<{
    id: string
    wanted: string | null
    status: string
    createdAt: string
    askedByName?: string | null
    agentName?: string | null
  }>
  heading?: string
}) {
  if (rows.length === 0) return null

  return (
    <div className="mt-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-black/45">{heading}</p>
      <ul className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 text-[13px]">
            <span className="w-24 shrink-0 tabular-nums text-black/40">{row.createdAt}</span>
            <span className="text-black/80">{row.wanted}</span>
            {(row.agentName || row.askedByName) && (
              <span className="text-black/40">· {row.agentName ?? row.askedByName}</span>
            )}
            <span className="text-black/45">{STATUS_WORDS[row.status] ?? 'With us'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/*
 * Our own words for our own statuses.
 *
 * "SOURCING" and "MATCHED" mean something to the people working the board and
 * nothing to a broker reading their phone. What they want to know is whether
 * anybody has picked it up.
 */
const STATUS_WORDS: Record<string, string> = {
  OPEN: '· with us',
  SOURCING: '· we are looking',
  MATCHED: '· we have found something',
  FULFILLED: '· found',
  CANCELLED: '· closed',
}
