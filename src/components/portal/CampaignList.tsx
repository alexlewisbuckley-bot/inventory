'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { ChevronRight, ListChecks, Plus, Trophy, Wallet, X } from 'lucide-react'
import { saveCampaignAction, type CampaignState } from '@/app/actions/partner-campaigns'
import { saveLeaderboardAction, type LeaderboardState } from '@/app/actions/leaderboards'
import { dubaiToday } from '@/lib/delivery'
import { timeline } from '@/lib/leaderboard'
import { CAMPAIGN_STATUS_LABELS, type CampaignKind, type CampaignStatus } from '@/lib/enums'
import { brandFill, brandVars, ui } from './ui'
import { PartnerMark, PortalHeader } from './PortalHeader'
import { PortalNav } from './PortalNav'

const INITIAL: CampaignState = { ok: false, message: '' }

/** The three kinds of campaign: two picked by each person, one competed for. */
type Choice = CampaignKind | 'LEADERBOARD'

const plusDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

export interface LeaderboardSummary {
  id: string; name: string; startsOn: string; endsOn: string; agentCount: number; prizeCount: number
}

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
export function CampaignList({ token, partnerName, campaigns, brandColor, accentColor, hasLogo = false, leaderboards = [] }: {
  hasLogo?: boolean
  /** Leaderboard challenges, listed with the other campaigns. */
  leaderboards?: LeaderboardSummary[]
  token: string
  partnerName: string
  brandColor?: string
  accentColor?: string
  campaigns: CampaignRow[]
}) {
  const [making, setMaking] = useState(false)

  return (
    <main className="min-h-screen bg-white" style={brandVars(brandColor, accentColor)}>
      <PortalHeader
        wide
        brand={<PartnerMark token={token} name={partnerName} hasLogo={hasLogo} />}
        eyebrow="Campaigns"
        subtitle={`Reward schemes ${partnerName} runs for its own people.`}
        actions={<PortalNav token={token} active="campaigns" />}
      />

      <div className="mx-auto max-w-[1480px] px-5 py-8 sm:px-8">
        <button
          type="button"
          onClick={() => setMaking(true)}
          className={`mb-6 ${ui.primary}`}
          style={brandFill}
        >
          <Plus className="h-4 w-4" aria-hidden />
          New campaign
        </button>

        {leaderboards.length > 0 && (
          <section className="mb-8">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-black/45">Leaderboard challenges</p>
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {leaderboards.map((board) => {
                const time = timeline(board.startsOn, board.endsOn, dubaiToday())
                return (
                  <li key={board.id}>
                    <Link href={`/p/${token}/leaderboards/${board.id}`}
                      className={`${ui.card} group flex items-center gap-3 p-4 transition hover:border-black/25`}>
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-black/55"><Trophy className="h-4 w-4" aria-hidden /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-serif text-[17px] text-black">{board.name}</span>
                        <span className="block truncate text-[12.5px] text-black/50">
                          {board.agentCount} agents · {board.prizeCount} prizes · {time.status === 'LIVE' ? `${time.daysLeft} days left` : time.status === 'UPCOMING' ? 'Starts soon' : 'Finished'}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-black/25 transition group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {campaigns.length > 0 && leaderboards.length > 0 && (
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-black/45">Reward campaigns</p>
        )}
        {campaigns.length === 0 && leaderboards.length > 0 ? null : campaigns.length === 0 ? (
          <div className="rounded-[16px] border border-black/10 px-6 py-12 text-center">
            <p className="font-serif text-[20px] text-black">No campaigns yet</p>
            <p className="mx-auto mt-2 max-w-[460px] text-[13.5px] leading-relaxed text-black/55">
              Reward people with a shortlist you pick or an amount each can spend — each gets
              their own link — or run a leaderboard challenge where your agents compete for prizes.
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
  const [kind, setKind] = useState<Choice>(campaign?.kind ?? 'SHORTLIST')
  /*
   * A leaderboard is created through its own action and lives on its own
   * page — agents, prizes, weekly figures — so choosing it here hands the
   * name and dates over and goes straight there.
   */
  const [boardState, boardAction] = useFormState<LeaderboardState, FormData>(
    saveLeaderboardAction.bind(null, { kind: 'portal', token }, null),
    { ok: false, message: '' },
  )
  const today = dubaiToday()
  useEffect(() => {
    if (boardState.ok && boardState.id) window.location.href = `/p/${token}/leaderboards/${boardState.id}`
  }, [boardState, token])

  if (state.ok) {
    // The list behind this is a server component, so a reload is what shows
    // the new campaign — and it is one round trip on a screen somebody uses
    // twice a year.
    if (typeof window !== 'undefined') window.location.reload()
  }

  return (
    <div
      className={ui.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={campaign ? 'Edit campaign' : 'New campaign'}
    >
      <div className={`${ui.dialog} max-w-[520px]`}>
        <div className="flex items-start justify-between gap-4">
          <p className="font-serif text-[21px] text-black">
            {campaign ? 'Edit campaign' : 'New campaign'}
          </p>
          <button type="button" onClick={onClose} aria-label="Close" className={ui.iconButton}>
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <form action={kind === 'LEADERBOARD' ? boardAction : action} className="mt-5 space-y-4">
          {campaign && <input type="hidden" name="id" value={campaign.id} />}

          <label className="block">
            <span className={ui.label}>
              Name
            </span>
            <input
              name="name"
              required
              defaultValue={campaign?.name ?? ''}
              placeholder="Q4 top performers"
              className={ui.field}
            />
          </label>

          <fieldset>
            <legend className={ui.label}>
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
                icon={ListChecks}
                title="A shortlist you choose"
                detail="You pick the watches. Everyone chooses one of them, and nobody sees a price."
              />
              <KindOption
                value="BUDGET" current={kind} onPick={setKind}
                icon={Wallet}
                title="An amount each person can spend"
                detail="Everyone sees what they can afford at your rate, with prices, and picks one."
              />
              {!campaign && (
                <KindOption
                  value="LEADERBOARD" current={kind} onPick={setKind}
                  icon={Trophy}
                  title="A leaderboard challenge"
                  detail="Your agents compete week by week on commission for watches, vouchers or cash you reserve up front."
                />
              )}
            </div>
          </fieldset>

          {kind === 'BUDGET' && (
            <label className="block">
              <span className={ui.label}>
                Amount each person can spend
              </span>
              <input
                name="budget"
                inputMode="decimal"
                required
                defaultValue={campaign?.budgetBase ? String(campaign.budgetBase / 100) : ''}
                placeholder="20000"
                className={ui.field}
              />
              <span className="mt-1 block text-[12px] text-black/45">
                In AED, at your rate — so this is what it costs you, not our asking price.
              </span>
            </label>
          )}

          {kind === 'LEADERBOARD' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className={ui.label}>Starts</span>
                <input name="startsOn" type="date" required defaultValue={today} className={ui.field} /></label>
              <label className="block"><span className={ui.label}>Ends</span>
                <input name="endsOn" type="date" required defaultValue={plusDays(today, 8 * 7 - 1)} className={ui.field} /></label>
              <input type="hidden" name="metricLabel" value="Commission earned" />
            </div>
          )}

          <label className="block">
            <span className={ui.label}>
              {kind === 'LEADERBOARD' ? 'A line for the agents (optional)' : 'What people read at the top of their page'}
            </span>
            <textarea
              name="intro"
              rows={3}
              defaultValue={campaign?.intro ?? ''}
              placeholder="In recognition of an exceptional year…"
              className={ui.textarea}
            />
          </label>

          {state.message && !state.ok && kind !== 'LEADERBOARD' && (
            <p role="alert" className={ui.error}>{state.message}</p>
          )}
          {boardState.message && !boardState.ok && kind === 'LEADERBOARD' && (
            <p role="alert" className={ui.error}>{boardState.message}</p>
          )}
          {kind === 'LEADERBOARD' && (
            <p className="text-[12.5px] text-black/50">Next you add your agents and choose the prizes, then launch it.</p>
          )}

          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className={`h-11 ${ui.ghost}`}>
              Cancel
            </button>
            <Save editing={Boolean(campaign)} label={kind === 'LEADERBOARD' ? 'Create challenge' : undefined} />
          </div>
        </form>
      </div>
    </div>
  )
}

function KindOption({ value, current, onPick, title, detail, icon: Icon }: {
  value: Choice
  current: Choice
  onPick: (value: Choice) => void
  title: string
  detail: string
  icon: typeof Trophy
}) {
  const picked = current === value
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-[14px] border p-3.5 transition ${
        picked ? 'border-transparent bg-white ring-2' : 'border-black/10 hover:border-black/30'
      }`}
      style={picked ? { ['--tw-ring-color' as string]: 'var(--brand, #111)' } : undefined}
    >
      <input type="radio" name="kind" value={value} checked={picked} onChange={() => onPick(value)} className="sr-only" />
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${picked ? 'text-white' : 'bg-black/[0.05] text-black/50'}`}
        style={picked ? { backgroundColor: 'var(--brand, #111)' } : undefined}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-black">{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-black/55">{detail}</span>
      </span>
      <span className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${picked ? 'border-transparent' : 'border-black/25'}`}
        style={picked ? { backgroundColor: 'var(--brand, #111)' } : undefined}>
        {picked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
    </label>
  )
}

function Save({ editing, label }: { editing: boolean; label?: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className={ui.primary}
      style={{ backgroundColor: 'var(--brand, #04173A)' }}
    >
      {pending ? 'Saving…' : editing ? 'Save' : label ?? 'Create'}
    </button>
  )
}
