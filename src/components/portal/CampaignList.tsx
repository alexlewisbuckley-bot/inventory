'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { ChevronRight, Plus, X } from 'lucide-react'
import { saveCampaignAction, type CampaignState } from '@/app/actions/partner-campaigns'
import { CAMPAIGN_STATUS_LABELS, type CampaignKind, type CampaignStatus } from '@/lib/enums'

const INITIAL: CampaignState = { ok: false, message: '' }

function money(base: number): string {
  return `AED ${Math.round(base / 100).toLocaleString('en-GB')}`
}

export interface CampaignRow {
  id: string
  name: string
  kind: CampaignKind
  budgetBase: number | null
  status: CampaignStatus
  recipientCount: number
  claimedCount: number
  itemCount: number
}

/**
 * A company's reward campaigns.
 *
 * The screen is for somebody in an HR or marketing office who does this twice
 * a year, so it carries its own instructions: what the two kinds are, in one
 * line each, at the moment of choosing between them rather than in a help page
 * nobody opens.
 */
export function CampaignList({ token, partnerName, campaigns }: {
  token: string
  partnerName: string
  campaigns: CampaignRow[]
}) {
  const [making, setMaking] = useState(false)

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-black/10 px-5 py-7 sm:px-8">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div>
            <p className="font-serif text-[26px] leading-tight text-black">Campaigns</p>
            <p className="mt-1 text-[13px] text-black/55">
              Reward schemes {partnerName} runs for its own people.
            </p>
          </div>
          <Link
            href={`/p/${token}`}
            className="text-[12px] uppercase tracking-[0.08em] text-black/40 hover:text-black/70"
          >
            Back to stock
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-[1180px] px-5 py-8 sm:px-8">
        <button
          type="button"
          onClick={() => setMaking(true)}
          className="mb-6 flex h-10 items-center gap-2 border border-black/15 px-4 text-[12.5px] font-semibold uppercase tracking-[0.07em] text-black hover:border-black/50"
        >
          <Plus className="h-4 w-4" aria-hidden />
          New campaign
        </button>

        {campaigns.length === 0 ? (
          <div className="border border-black/10 px-6 py-12 text-center">
            <p className="font-serif text-[20px] text-black">No campaigns yet</p>
            <p className="mx-auto mt-2 max-w-[460px] text-[13.5px] leading-relaxed text-black/55">
              A campaign is a list of people and something for each of them to choose from —
              either a shortlist you pick, or an amount each person can spend. Everyone gets
              their own link.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-black/10 border-y border-black/10">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <Link
                  href={`/p/${token}/campaigns/${campaign.id}`}
                  className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 py-4 hover:bg-black/[0.02]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-serif text-[18px] text-black">{campaign.name}</p>
                    <p className="truncate text-[12.5px] text-black/50">
                      {campaign.kind === 'BUDGET'
                        ? `${campaign.budgetBase ? money(campaign.budgetBase) : 'No amount set'} each`
                        : `${campaign.itemCount} ${campaign.itemCount === 1 ? 'watch' : 'watches'} to choose from`}
                    </p>
                  </div>

                  {/*
                    * Chosen out of invited, which is the number somebody opens
                    * this page for: the question is always who has not picked
                    * yet, and a total on its own does not answer it.
                    */}
                  <p className="text-[13px] tabular-nums text-black/60">
                    {campaign.claimedCount} of {campaign.recipientCount} chosen
                  </p>

                  <span className={`px-2 py-0.5 text-[11px] uppercase tracking-[0.06em] ${
                    campaign.status === 'OPEN'
                      ? 'bg-black/[0.06] text-black/70'
                      : 'text-black/40'
                  }`}>
                    {CAMPAIGN_STATUS_LABELS[campaign.status]}
                  </span>

                  <ChevronRight className="h-4 w-4 text-black/25" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {making && <CampaignForm token={token} onClose={() => setMaking(false)} />}
    </main>
  )
}

export function CampaignForm({ token, campaign, onClose }: {
  token: string
  campaign?: CampaignRow & { intro?: string | null }
  onClose: () => void
}) {
  const [state, action] = useFormState<CampaignState, FormData>(
    saveCampaignAction.bind(null, token),
    INITIAL,
  )
  const [kind, setKind] = useState<CampaignKind>(campaign?.kind ?? 'SHORTLIST')

  if (state.ok) {
    // The list behind this is a server component, so a reload is what shows
    // the new campaign — and it is one round trip on a screen somebody uses
    // twice a year.
    if (typeof window !== 'undefined') window.location.reload()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={campaign ? 'Edit campaign' : 'New campaign'}
    >
      <div className="w-full max-w-[520px] bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <p className="font-serif text-[21px] text-black">
            {campaign ? 'Edit campaign' : 'New campaign'}
          </p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-black/40 hover:text-black">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <form action={action} className="mt-5 space-y-4">
          {campaign && <input type="hidden" name="id" value={campaign.id} />}

          <label className="block">
            <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-black/55">
              Name
            </span>
            <input
              name="name"
              required
              defaultValue={campaign?.name ?? ''}
              placeholder="Q4 top performers"
              className="mt-1 h-11 w-full border border-black/15 px-3 text-[14px] text-black outline-none placeholder:text-black/30 focus:border-black/50"
            />
          </label>

          <fieldset>
            <legend className="text-[12px] font-semibold uppercase tracking-[0.06em] text-black/55">
              How people choose
            </legend>
            <div className="mt-2 space-y-2">
              {/*
                * Explained at the moment of choosing between them. Somebody
                * sets one of these up twice a year and will not have read
                * anything beforehand.
                */}
              <KindOption
                value="SHORTLIST" current={kind} onPick={setKind}
                title="A shortlist you choose"
                detail="You pick the watches. Everyone chooses one of them, and nobody sees a price."
              />
              <KindOption
                value="BUDGET" current={kind} onPick={setKind}
                title="An amount each person can spend"
                detail="Everyone sees what they can afford at your rate, with prices, and picks one."
              />
            </div>
          </fieldset>

          {kind === 'BUDGET' && (
            <label className="block">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-black/55">
                Amount each person can spend
              </span>
              <input
                name="budget"
                inputMode="decimal"
                required
                defaultValue={campaign?.budgetBase ? String(campaign.budgetBase / 100) : ''}
                placeholder="20000"
                className="mt-1 h-11 w-full border border-black/15 px-3 text-[14px] text-black outline-none placeholder:text-black/30 focus:border-black/50"
              />
              <span className="mt-1 block text-[12px] text-black/45">
                In AED, at your rate — so this is what it costs you, not our asking price.
              </span>
            </label>
          )}

          <label className="block">
            <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-black/55">
              What people read at the top of their page
            </span>
            <textarea
              name="intro"
              rows={3}
              defaultValue={campaign?.intro ?? ''}
              placeholder="In recognition of an exceptional year…"
              className="mt-1 w-full border border-black/15 px-3 py-2 text-[14px] text-black outline-none placeholder:text-black/30 focus:border-black/50"
            />
          </label>

          {state.message && !state.ok && (
            <p role="alert" className="text-[12.5px] text-[#b42318]">{state.message}</p>
          )}

          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="h-11 px-4 text-[12.5px] uppercase tracking-[0.07em] text-black/50 hover:text-black">
              Cancel
            </button>
            <Save editing={Boolean(campaign)} />
          </div>
        </form>
      </div>
    </div>
  )
}

function KindOption({ value, current, onPick, title, detail }: {
  value: CampaignKind
  current: CampaignKind
  onPick: (value: CampaignKind) => void
  title: string
  detail: string
}) {
  const picked = current === value
  return (
    <label className={`flex cursor-pointer gap-3 border p-3 ${picked ? 'border-black/60' : 'border-black/15'}`}>
      <input
        type="radio"
        name="kind"
        value={value}
        checked={picked}
        onChange={() => onPick(value)}
        className="mt-1 accent-black"
      />
      <span>
        <span className="block text-[14px] font-semibold text-black">{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-black/55">{detail}</span>
      </span>
    </label>
  )
}

function Save({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 px-5 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-white disabled:opacity-60"
      style={{ backgroundColor: 'var(--brand, #04173A)' }}
    >
      {pending ? 'Saving…' : editing ? 'Save' : 'Create'}
    </button>
  )
}
