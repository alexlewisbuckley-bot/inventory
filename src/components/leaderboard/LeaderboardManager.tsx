'use client'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useFormState, useFormStatus } from 'react-dom'
import {
  BarChart3, Camera, Check, Copy, ExternalLink, Gift, Link2, Lock, Pencil, Plus, Rocket, Search, Settings,
  Target, Trash2, Trophy, Users, Wallet, Watch as WatchIcon, X,
} from 'lucide-react'
import {
  addAgentAction, addPrizeAction, agentPhotoAction, deleteLeaderboardAction, publishLeaderboardAction,
  removeAgentAction, removePrizeAction, saveLeaderboardAction, saveWeekAction, updateAgentAction,
  updatePrizeAction, reservePrizeWatchAction, launchLeaderboardAction,
  type LeaderboardScope, type LeaderboardState,
} from '@/app/actions/leaderboards'
import { PRIZE_KINDS, PRIZE_KIND_LABELS } from '@/lib/enums'
import { launchProblems, weekStartOf, weeksOf } from '@/lib/leaderboard'
import { ui, brandFill } from '@/components/portal/ui'
import { LeaderboardBoard, ordinal, type BoardView } from './LeaderboardBoard'

const START: LeaderboardState = { ok: false, message: '' }

/** The board, plus whether it has been launched. */
export type ManagerBoard = BoardView & { launchedAt: string | null }

/** A watch that can be chosen as a prize, at the partner's price. */
export interface PrizeStock {
  id: string; brandName: string; model: string | null; modelName: string | null
  dial?: string | null; year?: number | null; priceGbp: number; imageIds: string[]
}
type Tab = 'board' | 'figures' | 'agents' | 'prizes' | 'settings'

const TABS: Array<{ key: Tab; label: string; Icon: typeof Trophy }> = [
  { key: 'board', label: 'Leaderboard', Icon: Trophy },
  { key: 'figures', label: 'Weekly figures', Icon: BarChart3 },
  { key: 'agents', label: 'Agents', Icon: Users },
  { key: 'prizes', label: 'Prizes', Icon: Gift },
  { key: 'settings', label: 'Settings & sharing', Icon: Settings },
]

const aed = (base: number) => `AED ${Math.round(base / 100).toLocaleString('en-GB')}`
const weekLabel = (iso: string) => {
  const start = new Date(`${iso}T00:00:00Z`)
  const end = new Date(start.getTime() + 6 * 86_400_000)
  const f = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${f(start)} – ${f(end)}`
}

/**
 * Running a leaderboard challenge, from either side of the counter.
 *
 * The same screen for a partner in their portal and for our staff on the
 * partner's page; the scope decides who is checked and what they may touch.
 * The board sits on the first tab, so whoever enters a week's figures sees
 * what that did straight away.
 */
export function LeaderboardManager({ scope, board, id, shareToken, isPublished, photoBase, today, backHref, stock }: {
  scope: LeaderboardScope
  board: ManagerBoard
  stock: PrizeStock[]
  id: string
  shareToken: string
  isPublished: boolean
  photoBase: string
  today: string
  backHref: string
}) {
  const router = useRouter()
  const launched = board.launchedAt !== null
  const [tab, setTab] = useState<Tab>(launched ? 'board' : board.agents.length === 0 ? 'agents' : 'prizes')
  const [flash, setFlash] = useState<LeaderboardState | null>(null)
  const [launching, startLaunch] = useTransition()
  const done = (result: LeaderboardState) => {
    setFlash(result)
    if (result.ok) router.refresh()
  }
  const stockBase = `/l/${shareToken}/stock`
  const problems = launchProblems({
    agents: board.agents,
    prizes: board.prizes.map((p) => ({ name: p.name, kind: p.kind, orderId: p.orderId ?? null, holdLive: p.holdLive ?? false })),
  })
  const heldWatches = board.prizes.filter((p) => p.kind === 'WATCH' && p.holdLive).length
  const otherPrizes = board.prizes.filter((p) => p.kind !== 'WATCH').length

  return (
    <div className="space-y-6">
      {!launched && (
        /*
         * The way to launch, until it has happened.
         *
         * Alex: the company MUST choose its watches or vouchers before the
         * challenge starts. So the three things that have to be true are
         * shown as steps, ticked as they come true, with the button live
         * only once all of them are.
         */
        <section className="overflow-hidden rounded-[18px] border border-black/10 bg-gradient-to-br from-black/[0.03] to-white">
          <div className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-black/40">Before you launch</p>
              <p className="mt-1 font-serif text-[22px] leading-snug text-black">Set the challenge up, then start the clock</p>
            </div>
            <button type="button" disabled={problems.length > 0 || launching} className={ui.primary} style={brandFill}
              onClick={() => startLaunch(async () => done(await launchLeaderboardAction(scope, id)))}>
              <Rocket className="h-4 w-4" aria-hidden />{launching ? 'Launching…' : 'Launch challenge'}
            </button>
          </div>
          <ol className="grid border-t border-black/[0.06] sm:grid-cols-3">
            {[
              { done: board.agents.length > 0, title: 'Add your agents', detail: board.agents.length ? `${board.agents.length} added` : 'Names, teams and photos', go: 'agents' as Tab },
              { done: board.prizes.length > 0 && problems.every((p) => !p.includes('"')), title: 'Choose the prizes', detail: board.prizes.length ? [heldWatches && `${heldWatches} ${heldWatches === 1 ? 'watch' : 'watches'} reserved`, otherPrizes && `${otherPrizes} voucher/cash`].filter(Boolean).join(' · ') || 'Needs attention' : 'Watches from stock, or vouchers', go: 'prizes' as Tab },
              { done: false, title: 'Launch', detail: problems.length ? problems[0]! : 'Ready — figures and sharing open once launched', go: null },
            ].map((step, i) => (
              <li key={step.title} className="border-black/[0.06] sm:border-l sm:first:border-l-0">
                <button type="button" disabled={!step.go} onClick={() => step.go && setTab(step.go)}
                  className="flex w-full items-start gap-3 p-5 text-left transition enabled:hover:bg-black/[0.02]">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${step.done ? 'text-white' : 'border border-black/15 text-black/50'}`}
                    style={step.done ? brandFill : undefined}>
                    {step.done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold text-black">{step.title}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-black/50">{step.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="tablist">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => { setTab(key); setFlash(null) }}
            className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium transition ${
              tab === key ? 'text-white shadow-sm' : 'bg-black/[0.04] text-black/60 hover:bg-black/[0.08] hover:text-black'
            }`}
            style={tab === key ? brandFill : undefined}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
            {!launched && key === 'figures' && <Lock className="h-3 w-3 opacity-60" aria-label="after launch" />}
            {key === 'agents' && <span className="tabular-nums opacity-60">{board.agents.length}</span>}
            {key === 'prizes' && <span className="tabular-nums opacity-60">{board.prizes.length}</span>}
          </button>
        ))}
      </nav>

      {flash?.message && (
        <p role="status" className={`rounded-[10px] px-4 py-2.5 text-[13px] ${
          flash.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
        }`}>
          {flash.message}
        </p>
      )}

      {tab === 'board' && <LeaderboardBoard board={board} photoBase={photoBase} stockBase={stockBase} today={today} />}
      {tab === 'figures' && (launched
        ? <Figures scope={scope} id={id} board={board} today={today} onDone={done} />
        : <Empty>Weekly figures open once the challenge is launched — choose the prizes first, then launch it above.</Empty>)}
      {tab === 'agents' && <Agents scope={scope} id={id} board={board} photoBase={photoBase} onDone={done} />}
      {tab === 'prizes' && <Prizes scope={scope} id={id} board={board} stock={stock} stockBase={stockBase} onDone={done} />}
      {tab === 'settings' && (
        <SettingsTab scope={scope} id={id} board={board} shareToken={shareToken} isPublished={isPublished}
          launched={launched} onDone={done} backHref={backHref} />
      )}
    </div>
  )
}

/** One week at a time, every agent in one table, saved together. */
function Figures({ scope, id, board, today, onDone }: {
  scope: LeaderboardScope; id: string; board: BoardView; today: string; onDone: (r: LeaderboardState) => void
}) {
  const weeks = useMemo(() => weeksOf(board.startsOn, board.endsOn), [board.startsOn, board.endsOn])
  const thisWeek = weekStartOf(today)
  const [week, setWeek] = useState(weeks.includes(thisWeek) ? thisWeek : thisWeek > weeks.at(-1)! ? weeks.at(-1)! : weeks[0]!)
  const [pending, start] = useTransition()
  const existing = (agentId: string) => board.entries.find((e) => e.agentId === agentId && e.weekStart === week)
  const [values, setValues] = useState<Record<string, { commission: string; deals: string }>>({})
  const valueFor = (agentId: string) => values[`${week}:${agentId}`] ?? {
    commission: existing(agentId) ? String(existing(agentId)!.commissionBase / 100) : '',
    deals: existing(agentId) ? String(existing(agentId)!.deals) : '',
  }
  const set = (agentId: string, field: 'commission' | 'deals', value: string) =>
    setValues((v) => ({ ...v, [`${week}:${agentId}`]: { ...valueFor(agentId), [field]: value } }))
  const filled = new Set(board.entries.map((e) => e.weekStart))

  if (board.agents.length === 0) {
    return <Empty>Add your agents first, then their figures go in here each week.</Empty>
  }

  const save = () => start(async () => {
    onDone(await saveWeekAction(scope, id, week, board.agents.map((a) => ({ agentId: a.id, ...valueFor(a.id) }))))
  })

  return (
    <div className={`${ui.card} overflow-hidden`}>
      <div className="border-b border-black/[0.06] p-5">
        <p className={ui.label}>Which week</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {weeks.map((w, i) => {
            const on = w === week
            return (
              <button key={w} type="button" onClick={() => setWeek(w)}
                className={`rounded-[10px] border px-3 py-1.5 text-left transition ${
                  on ? 'border-transparent text-white' : 'border-black/10 bg-white hover:border-black/30'
                }`}
                style={on ? brandFill : undefined}
              >
                <span className="block text-[12px] font-semibold">
                  Week {i + 1} {filled.has(w) && <Check className="ml-0.5 inline h-3 w-3" aria-label="entered" />}
                </span>
                <span className={`block text-[11px] ${on ? 'text-white/70' : 'text-black/45'}`}>{weekLabel(w)}</span>
              </button>
            )
          })}
        </div>
      </div>

      <table className="w-full text-left text-[13.5px]">
        <thead className="bg-black/[0.02] text-[11px] uppercase tracking-[0.1em] text-black/45">
          <tr>
            <th className="px-5 py-3 font-semibold">Agent</th>
            <th className="px-3 py-3 font-semibold">{board.metricLabel} (AED)</th>
            <th className="px-3 py-3 font-semibold">Deals</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/[0.06]">
          {board.agents.map((agent) => {
            const v = valueFor(agent.id)
            return (
              <tr key={agent.id}>
                <td className="px-5 py-2.5">
                  <p className="font-semibold text-black">{agent.name}</p>
                  {agent.subtitle && <p className="text-[12px] text-black/45">{agent.subtitle}</p>}
                </td>
                <td className="px-3 py-2.5">
                  <input inputMode="decimal" value={v.commission} placeholder="0"
                    onChange={(e) => set(agent.id, 'commission', e.target.value)}
                    aria-label={`${board.metricLabel} for ${agent.name}`}
                    className={`${ui.field} !mt-0 max-w-[180px] tabular-nums`} />
                </td>
                <td className="px-3 py-2.5">
                  <input inputMode="numeric" value={v.deals} placeholder="0"
                    onChange={(e) => set(agent.id, 'deals', e.target.value.replace(/\D/g, ''))}
                    aria-label={`Deals for ${agent.name}`}
                    className={`${ui.field} !mt-0 max-w-[90px] tabular-nums`} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center gap-3 border-t border-black/[0.06] p-5">
        <p className="text-[12.5px] text-black/50">
          Saving a week again replaces it. Leave both boxes empty to remove an agent&rsquo;s figure for the week.
        </p>
        <button type="button" onClick={save} disabled={pending} className={`ml-auto ${ui.primary}`} style={brandFill}>
          {pending ? 'Saving…' : `Save ${weekLabel(week)}`}
        </button>
      </div>
    </div>
  )
}

function Agents({ scope, id, board, photoBase, onDone }: {
  scope: LeaderboardScope; id: string; board: BoardView; photoBase: string; onDone: (r: LeaderboardState) => void
}) {
  const [state, action] = useFormState(addAgentAction.bind(null, scope, id), START)
  const form = useRef<HTMLFormElement>(null)
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState<string | null>(null)
  useEffect(() => {
    if (!state.message) return
    onDone(state)
    if (state.ok) form.current?.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className={`${ui.card} divide-y divide-black/[0.06]`}>
        {board.agents.length === 0 && <div className="p-6"><Empty>No agents yet. Add the first one alongside.</Empty></div>}
        {board.agents.map((agent) => editing === agent.id ? (
          <AgentEditor key={agent.id} agent={agent} photoBase={photoBase} busy={pending}
            onCancel={() => setEditing(null)}
            onSave={(data) => start(async () => {
              const result = await updateAgentAction(scope, id, agent.id, data)
              onDone(result)
              if (result.ok) setEditing(null)
            })} />
        ) : (
          <div key={agent.id} className="flex items-center gap-4 p-4">
            <label className="group relative h-14 w-14 shrink-0 cursor-pointer overflow-hidden rounded-full bg-black/[0.06]" title="Change photo">
              {agent.hasPhoto
                /* eslint-disable-next-line @next/next/no-img-element */
                ? <img src={`${photoBase}/${agent.id}?v=${agent.photoVersion ?? 0}`} alt="" className="h-full w-full object-cover" />
                : <span className="flex h-full w-full items-center justify-center text-[18px] font-semibold text-black/45">
                    {agent.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                  </span>}
              <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition group-hover:opacity-100">
                <Camera className="h-4 w-4" aria-hidden />
              </span>
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
                aria-label={`Photo for ${agent.name}`}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  const data = new FormData()
                  data.set('photo', file)
                  start(async () => onDone(await agentPhotoAction(scope, id, agent.id, data)))
                }} />
            </label>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14.5px] font-semibold text-black">{agent.name}</p>
              <p className="truncate text-[12.5px] text-black/45">{agent.subtitle || (agent.hasPhoto ? '' : 'Tap the circle to add a photo')}</p>
            </div>
            <button type="button" disabled={pending} className={ui.iconButton} aria-label={`Edit ${agent.name}`}
              onClick={() => setEditing(agent.id)}>
              <Pencil className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" disabled={pending} className={ui.iconButton} aria-label={`Remove ${agent.name}`}
              onClick={() => {
                if (!confirm(`Remove ${agent.name} and all their figures?`)) return
                start(async () => onDone(await removeAgentAction(scope, id, agent.id)))
              }}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>

      <form ref={form} action={action} className={`${ui.card} space-y-3 p-5 lg:sticky lg:top-24 lg:self-start`}>
        <p className="text-[15px] font-semibold text-black">Add an agent</p>
        <label className="block"><span className={ui.label}>Name</span>
          <input name="name" required className={ui.field} placeholder="e.g. Sara Haddad" /></label>
        <label className="block"><span className={ui.label}>Team or title <span className="normal-case tracking-normal text-black/35">· optional</span></span>
          <input name="subtitle" className={ui.field} placeholder="e.g. Dubai Marina office" /></label>
        <label className="block"><span className={ui.label}>Photo <span className="normal-case tracking-normal text-black/35">· optional</span></span>
          <input name="photo" type="file" accept="image/png,image/jpeg,image/webp"
            className="mt-1.5 block w-full text-[13px] text-black/60 file:mr-3 file:rounded-full file:border-0 file:bg-black/[0.06] file:px-4 file:py-2 file:text-[12.5px] file:font-medium file:text-black hover:file:bg-black/[0.1]" />
        </label>
        <Submit label="Add agent" />
      </form>
    </div>
  )
}

function Prizes({ scope, id, board, stock, stockBase, onDone }: {
  scope: LeaderboardScope; id: string; board: ManagerBoard
  stock: PrizeStock[]; stockBase: string; onDone: (r: LeaderboardState) => void
}) {
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState<null | 'WATCH' | 'OTHER'>(board.prizes.length === 0 ? 'WATCH' : null)
  const nextRank = Math.max(0, ...board.prizes.filter((p) => p.rule === 'RANK').map((p) => p.rank ?? 0)) + 1
  const total = board.prizes.reduce((sum, p) => sum + (p.valueBase ?? 0), 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold text-black">What the agents are playing for</p>
          <p className="mt-0.5 text-[13px] text-black/55">
            Watch prizes are reserved from our stock for you as soon as you choose them. Vouchers and cash are
            put towards a watch when the challenge ends.
          </p>
        </div>
        {board.prizes.length > 0 && (
          <p className="text-[13px] text-black/55">
            {board.prizes.length} {board.prizes.length === 1 ? 'prize' : 'prizes'}
            {total > 0 && <> · <span className="font-semibold tabular-nums text-black">{aed(total)}</span> in total</>}
          </p>
        )}
      </div>

      {board.prizes.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {board.prizes.map((prize) => (
            <li key={prize.id} className={`${ui.card} overflow-hidden`}>
              {editing === prize.id ? (
                <div className="p-4">
                  <PrizeFields
                    prize={prize}
                    metricLabel={board.metricLabel}
                    busy={pending}
                    onCancel={() => setEditing(null)}
                    onSave={(data) => start(async () => {
                      const result = await updatePrizeAction(scope, id, prize.id, data)
                      onDone(result)
                      if (result.ok) setEditing(null)
                    })}
                  />
                </div>
              ) : (
                <div className="flex gap-4 p-4">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-black/[0.03]">
                    {prize.imageId
                      /* eslint-disable-next-line @next/next/no-img-element */
                      ? <img src={`${stockBase}/${prize.imageId}`} alt="" className="h-full w-full object-contain p-1.5 mix-blend-multiply" />
                      : prize.kind === 'CASH' ? <Wallet className="h-6 w-6 text-black/40" aria-hidden /> : <Gift className="h-6 w-6 text-black/40" aria-hidden />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.05] px-2 py-0.5 text-[11.5px] font-semibold text-black/70">
                        {prize.rule === 'RANK' ? <><Trophy className="h-3 w-3" aria-hidden />{ordinal(prize.rank!)} place</> : <><Target className="h-3 w-3" aria-hidden />Reach {aed(prize.targetBase!)}</>}
                      </span>
                      {prize.kind === 'WATCH' && (prize.orderId
                        ? prize.holdLive
                          ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20"><Lock className="h-3 w-3" aria-hidden />Reserved for you</span>
                          : <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11.5px] font-medium text-rose-700 ring-1 ring-inset ring-rose-600/20">Hold released</span>
                        : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11.5px] font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">Not from stock</span>)}
                    </div>
                    <p className="mt-1.5 line-clamp-2 font-serif text-[16.5px] leading-snug text-black">{prize.name}</p>
                    <p className="mt-0.5 text-[12.5px] text-black/45">
                      {PRIZE_KIND_LABELS[prize.kind]}{prize.valueBase ? ` · ${aed(prize.valueBase)}` : ''}
                      {prize.stockNo !== null && prize.stockNo !== undefined ? ` · Stock ${prize.stockNo}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button type="button" disabled={pending} className={ui.iconButton} aria-label={`Edit ${prize.name}`}
                      onClick={() => setEditing(prize.id)}>
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button type="button" disabled={pending} className={ui.iconButton} aria-label={`Remove ${prize.name}`}
                      onClick={() => {
                        if (prize.orderId && prize.holdLive && !confirm(`Remove "${prize.name}"? The watch will be released back into stock.`)) return
                        start(async () => onDone(await removePrizeAction(scope, id, prize.id)))
                      }}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Adding: choose what kind first, then the rest. */}
      {adding === null ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <AddChoice icon={WatchIcon} title="A watch from stock" sub="Choose from what is available and reserve it for you" onClick={() => setAdding('WATCH')} />
          <AddChoice icon={Gift} title="A voucher or cash" sub="An amount towards a watch, or a cash prize" onClick={() => setAdding('OTHER')} />
        </div>
      ) : adding === 'WATCH' ? (
        <WatchPicker
          stock={stock}
          stockBase={stockBase}
          nextRank={nextRank}
          metricLabel={board.metricLabel}
          busy={pending}
          onCancel={() => setAdding(null)}
          onReserve={(input) => start(async () => {
            const result = await reservePrizeWatchAction(scope, id, input)
            onDone(result)
            if (result.ok) setAdding(null)
          })}
        />
      ) : (
        <OtherPrize
          nextRank={nextRank}
          metricLabel={board.metricLabel}
          busy={pending}
          onCancel={() => setAdding(null)}
          onAdd={(data) => start(async () => {
            const result = await addPrizeAction(scope, id, START, data)
            onDone(result)
            if (result.ok) setAdding(null)
          })}
        />
      )}
    </div>
  )
}

function AddChoice({ icon: Icon, title, sub, onClick }: { icon: typeof Gift; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="group flex items-center gap-4 rounded-[16px] border border-dashed border-black/20 bg-white p-5 text-left transition hover:border-solid hover:border-black/40 hover:shadow-[0_8px_30px_-18px_rgba(0,0,0,0.35)]">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-black/60 transition group-hover:text-white" style={undefined}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[14.5px] font-semibold text-black"><Plus className="h-4 w-4" aria-hidden />{title}</span>
        <span className="mt-0.5 block text-[12.5px] text-black/50">{sub}</span>
      </span>
    </button>
  )
}

/** How a prize is won: a position from a row of pills, or a target amount. */
function HowWon({ rule, setRule, rank, setRank, target, setTarget, metricLabel }: {
  rule: 'RANK' | 'TARGET'; setRule: (r: 'RANK' | 'TARGET') => void
  rank: number; setRank: (n: number) => void
  target: string; setTarget: (t: string) => void
  metricLabel: string
}) {
  return (
    <div className="space-y-3">
      <div>
        <span className={ui.label}>How it is won</span>
        <div className="mt-1.5 inline-flex w-full rounded-full bg-black/[0.05] p-1 sm:w-auto">
          {([['RANK', 'Finishing position'], ['TARGET', 'Hitting a target']] as const).map(([key, title]) => (
            <button key={key} type="button" onClick={() => setRule(key)} aria-pressed={rule === key}
              className={`flex-1 rounded-full px-4 py-2 text-[13px] font-medium transition sm:flex-none ${rule === key ? 'bg-white text-black shadow-sm' : 'text-black/55 hover:text-black'}`}>
              {title}
            </button>
          ))}
        </div>
      </div>
      {rule === 'RANK' ? (
        <div>
          <span className={ui.label}>Position</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" onClick={() => setRank(n)} aria-pressed={rank === n}
                className={`h-10 min-w-[52px] rounded-full border px-3 text-[13px] font-semibold tabular-nums transition ${
                  rank === n ? 'border-transparent text-white' : 'border-black/10 bg-white text-black/70 hover:border-black/30'
                }`}
                style={rank === n ? brandFill : undefined}>
                {ordinal(n)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <label className="block max-w-[320px]"><span className={ui.label}>Target {metricLabel.toLowerCase()} (AED)</span>
          <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. 500000" className={ui.field} /></label>
      )}
    </div>
  )
}

/** Choose a watch from what is available, then reserve it as a prize. */
function WatchPicker({ stock, stockBase, nextRank, metricLabel, busy, onReserve, onCancel }: {
  stock: PrizeStock[]; stockBase: string; nextRank: number; metricLabel: string; busy: boolean
  onReserve: (input: { watchId: string; rule: 'RANK' | 'TARGET'; rank: number | null; target: string }) => void
  onCancel: () => void
}) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [rule, setRule] = useState<'RANK' | 'TARGET'>('RANK')
  const [rank, setRank] = useState(Math.min(nextRank, 10))
  const [target, setTarget] = useState('')
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return stock.filter((w) => {
      const hay = [w.brandName, w.model, w.modelName, w.dial, w.year].filter(Boolean).join(' ').toLowerCase()
      return words.every((word) => hay.includes(word))
    })
  }, [stock, q])
  const chosen = stock.find((w) => w.id === picked) ?? null

  return (
    <div className={`${ui.card} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] p-5">
        <div>
          <p className="flex items-center gap-2 text-[15px] font-semibold text-black"><WatchIcon className="h-4 w-4" aria-hidden />Choose a watch from stock</p>
          <p className="mt-0.5 text-[12.5px] text-black/50">{stock.length} available at your price. It is reserved for you the moment you add it.</p>
        </div>
        <button type="button" onClick={onCancel} className={ui.iconButton} aria-label="Cancel"><X className="h-4 w-4" aria-hidden /></button>
      </div>

      <div className="p-5">
        <label className="relative block">
          <span className="sr-only">Search stock</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-black/30" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search brand, model, reference or dial" autoFocus
            className="h-11 w-full rounded-full border border-black/12 bg-black/[0.03] pl-11 pr-4 text-[14px] text-black outline-none transition placeholder:text-black/35 focus:border-black/40 focus:bg-white focus:ring-4 focus:ring-black/[0.05]" />
        </label>

        <ul className="mt-4 grid max-h-[460px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4" role="listbox" aria-label="Available watches">
          {shown.length === 0 && <li className="col-span-full py-10 text-center text-[13.5px] text-black/45">Nothing matches that.</li>}
          {shown.map((w) => {
            const on = w.id === picked
            return (
              <li key={w.id} role="option" aria-selected={on}>
                <button type="button" onClick={() => setPicked(on ? null : w.id)}
                  className={`relative flex w-full flex-col rounded-[14px] border bg-white p-2.5 text-left transition ${on ? 'border-transparent ring-2' : 'border-black/10 hover:border-black/30'}`}
                  style={on ? { ['--tw-ring-color' as string]: 'var(--brand)' } : undefined}>
                  <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-[10px] bg-black/[0.025]">
                    {w.imageIds[0]
                      /* eslint-disable-next-line @next/next/no-img-element */
                      ? <img src={`${stockBase}/${w.imageIds[0]}`} alt="" loading="lazy" className="h-full w-full object-contain p-2 mix-blend-multiply" />
                      : <WatchIcon className="h-6 w-6 text-black/20" aria-hidden />}
                  </span>
                  <span className="mt-2 line-clamp-2 min-h-[2.5em] text-[12.5px] font-semibold leading-snug text-black">
                    {[w.brandName, w.model, w.modelName].filter(Boolean).join(' ')}
                  </span>
                  <span className="mt-0.5 text-[12.5px] tabular-nums text-black/55">{aed(w.priceGbp)}</span>
                  {on && (
                    <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-white shadow" style={brandFill}>
                      <Check className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      <div className={`border-t border-black/[0.06] bg-black/[0.015] p-5 transition-opacity ${chosen ? '' : 'pointer-events-none opacity-40'}`} aria-disabled={!chosen}>
        <HowWon rule={rule} setRule={setRule} rank={rank} setRank={setRank} target={target} setTarget={setTarget} metricLabel={metricLabel} />
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-black/60">
            {chosen
              ? <><span className="font-semibold text-black">{[chosen.brandName, chosen.model].filter(Boolean).join(' ')}</span> · {aed(chosen.priceGbp)}</>
              : 'Choose a watch above.'}
          </p>
          <button type="button" disabled={!chosen || busy} className={ui.primary} style={brandFill}
            onClick={() => chosen && onReserve({ watchId: chosen.id, rule, rank: rule === 'RANK' ? rank : null, target })}>
            <Lock className="h-4 w-4" aria-hidden />{busy ? 'Reserving…' : 'Reserve as prize'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** A voucher towards a watch, or cash. */
function OtherPrize({ nextRank, metricLabel, busy, onAdd, onCancel }: {
  nextRank: number; metricLabel: string; busy: boolean
  onAdd: (data: FormData) => void; onCancel: () => void
}) {
  const [kind, setKind] = useState<'VOUCHER' | 'CASH'>('VOUCHER')
  const [rule, setRule] = useState<'RANK' | 'TARGET'>('RANK')
  const [rank, setRank] = useState(Math.min(nextRank, 10))
  const [target, setTarget] = useState('')
  return (
    <form className={`${ui.card} space-y-4 p-5`}
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        data.set('kind', kind); data.set('rule', rule); data.set('rank', String(rank)); data.set('target', target)
        onAdd(data)
      }}>
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-[15px] font-semibold text-black"><Gift className="h-4 w-4" aria-hidden />A voucher or cash</p>
        <button type="button" onClick={onCancel} className={ui.iconButton} aria-label="Cancel"><X className="h-4 w-4" aria-hidden /></button>
      </div>
      <div className="inline-flex rounded-full bg-black/[0.05] p-1">
        {([['VOUCHER', 'Voucher towards a watch'], ['CASH', 'Cash']] as const).map(([key, title]) => (
          <button key={key} type="button" onClick={() => setKind(key)} aria-pressed={kind === key}
            className={`rounded-full px-4 py-2 text-[13px] font-medium transition ${kind === key ? 'bg-white text-black shadow-sm' : 'text-black/55 hover:text-black'}`}>
            {title}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <label className="block"><span className={ui.label}>Name</span>
          <input name="name" required className={ui.field} placeholder={kind === 'VOUCHER' ? 'e.g. AED 10,000 watch voucher' : 'e.g. AED 5,000 cash bonus'} /></label>
        <label className="block"><span className={ui.label}>Amount (AED)</span>
          <input name="value" required inputMode="decimal" className={ui.field} placeholder="10000" /></label>
      </div>
      <HowWon rule={rule} setRule={setRule} rank={rank} setRank={setRank} target={target} setTarget={setTarget} metricLabel={metricLabel} />
      <div className="flex justify-end">
        <button type="submit" disabled={busy} className={ui.primary} style={brandFill}>
          <Plus className="h-4 w-4" aria-hidden />{busy ? 'Adding…' : 'Add prize'}
        </button>
      </div>
    </form>
  )
}

function SettingsTab({ scope, id, board, shareToken, isPublished, launched, onDone, backHref }: {
  scope: LeaderboardScope; id: string; board: BoardView; shareToken: string; isPublished: boolean; launched: boolean
  onDone: (r: LeaderboardState) => void; backHref: string
}) {
  const [state, action] = useFormState(saveLeaderboardAction.bind(null, scope, id), START)
  const [pending, start] = useTransition()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (state.message) onDone(state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])
  const url = typeof window === 'undefined' ? `/l/${shareToken}` : `${window.location.origin}/l/${shareToken}`

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <form action={action} className={`${ui.card} space-y-3 p-5`}>
        <p className="text-[15px] font-semibold text-black">The challenge</p>
        <label className="block"><span className={ui.label}>Name</span>
          <input name="name" required defaultValue={board.name} className={ui.field} /></label>
        <label className="block"><span className={ui.label}>A line for the agents <span className="normal-case tracking-normal text-black/35">· optional</span></span>
          <textarea name="intro" rows={2} defaultValue={board.intro ?? ''} className={ui.textarea} /></label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block"><span className={ui.label}>Starts</span>
            <input name="startsOn" type="date" required defaultValue={board.startsOn} className={ui.field} /></label>
          <label className="block"><span className={ui.label}>Ends</span>
            <input name="endsOn" type="date" required defaultValue={board.endsOn} className={ui.field} /></label>
          <label className="block"><span className={ui.label}>Ranked on</span>
            <input name="metricLabel" defaultValue={board.metricLabel} className={ui.field} /></label>
        </div>
        <Submit label="Save changes" />
      </form>

      <div className="space-y-4">
        <div className={`${ui.card} p-5`}>
          <p className="flex items-center gap-2 text-[15px] font-semibold text-black"><Link2 className="h-4 w-4" aria-hidden />Share link</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-black/55">
            A read-only board to send to the agents or put on an office screen. Nobody can change anything from it.
          </p>
          {!launched && <p className="mt-3 rounded-[10px] bg-black/[0.04] px-3 py-2 text-[12.5px] text-black/60">Available once the challenge is launched.</p>}
          <button type="button" role="switch" aria-checked={isPublished} disabled={pending || !launched}
            onClick={() => start(async () => onDone(await publishLeaderboardAction(scope, id, !isPublished)))}
            className="mt-4 flex w-full items-center justify-between rounded-[12px] border border-black/10 px-4 py-3 text-left">
            <span className="text-[13.5px] font-medium text-black">{isPublished ? 'Link is live' : 'Link is off'}</span>
            <span className={`relative h-6 w-11 rounded-full transition ${isPublished ? '' : 'bg-black/15'}`} style={isPublished ? brandFill : undefined}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${isPublished ? 'left-[22px]' : 'left-0.5'}`} />
            </span>
          </button>
          {isPublished && (
            <div className="mt-3 flex gap-2">
              <input readOnly value={url} onFocus={(e) => e.target.select()} className={`${ui.field} !mt-0 text-[12.5px]`} aria-label="Share link" />
              <button type="button" className={`${ui.outline} shrink-0`} onClick={() => {
                void navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600)
              }}>
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <a href={url} target="_blank" rel="noreferrer" className={ui.iconButton} aria-label="Open the share link">
                <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            </div>
          )}
        </div>

        <div className={`${ui.card} p-5`}>
          <p className="text-[15px] font-semibold text-black">Delete this challenge</p>
          <p className="mt-1 text-[12.5px] text-black/55">Removes the agents, prizes and every week&rsquo;s figures. This cannot be undone.</p>
          <button type="button" disabled={pending}
            className="mt-3 inline-flex items-center gap-2 rounded-full border border-rose-200 px-4 py-2 text-[12px] font-medium uppercase tracking-[0.1em] text-rose-700 hover:bg-rose-50"
            onClick={() => {
              if (!confirm(`Delete "${board.name}" for good?`)) return
              start(async () => {
                const result = await deleteLeaderboardAction(scope, id)
                if (result.ok) window.location.href = backHref
                else onDone(result)
              })
            }}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete challenge
          </button>
        </div>
      </div>
    </div>
  )
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className={`w-full ${ui.primary}`} style={brandFill}>
      <Plus className={`h-4 w-4 ${label.startsWith('Add') ? '' : 'hidden'}`} aria-hidden />
      {pending ? 'Saving…' : label}
    </button>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-[14px] border border-dashed border-black/15 px-6 py-10 text-center text-[13.5px] text-black/45">{children}</p>
}

type Agent = BoardView['agents'][number]

/**
 * One agent, opened up for editing where they sit in the list.
 *
 * In place rather than in a dialog: the row is the thing being changed, and
 * opening it where it is keeps the rest of the list in view for comparison.
 */
function AgentEditor({ agent, photoBase, busy, onSave, onCancel }: {
  agent: Agent; photoBase: string; busy: boolean
  onSave: (data: FormData) => void; onCancel: () => void
}) {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const shown = preview ?? (agent.hasPhoto ? `${photoBase}/${agent.id}?v=${agent.photoVersion ?? 0}` : null)

  return (
    <form
      onSubmit={(event) => { event.preventDefault(); onSave(new FormData(event.currentTarget)) }}
      onKeyDown={(event) => { if (event.key === 'Escape') onCancel() }}
      className="flex flex-col gap-4 bg-black/[0.015] p-4 sm:flex-row sm:items-start"
    >
      <label className="group relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-full bg-black/[0.06] ring-2 ring-white" title="Change photo">
        {shown
          /* eslint-disable-next-line @next/next/no-img-element */
          ? <img src={shown} alt="" className="h-full w-full object-cover" />
          : <span className="flex h-full w-full items-center justify-center text-[18px] font-semibold text-black/45">
              {agent.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
            </span>}
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition group-hover:opacity-100">
          <Camera className="h-4 w-4" aria-hidden />
        </span>
        <input name="photo" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
          aria-label={`New photo for ${agent.name}`}
          onChange={(e) => {
            const file = e.target.files?.[0]
            setPreview(file ? URL.createObjectURL(file) : null)
          }} />
      </label>
      <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
        <label className="block"><span className={ui.label}>Name</span>
          <input name="name" required autoFocus defaultValue={agent.name} className={ui.field} /></label>
        <label className="block"><span className={ui.label}>Team or title</span>
          <input name="subtitle" defaultValue={agent.subtitle ?? ''} className={ui.field} placeholder="optional" /></label>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          <button type="button" onClick={onCancel} className={ui.ghost}>Cancel</button>
          <button type="submit" disabled={busy} className={`${ui.primary} !h-10`} style={brandFill}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </form>
  )
}

/** A prize's fields, for changing one that already exists. */
function PrizeFields({ prize, metricLabel, busy, onSave, onCancel }: {
  prize: BoardView['prizes'][number]; metricLabel: string; busy: boolean
  onSave: (data: FormData) => void; onCancel: () => void
}) {
  const [rule, setRule] = useState<'RANK' | 'TARGET'>(prize.rule)
  const whole = (base: number | null) => (base ? String(base / 100) : '')
  return (
    <form
      onSubmit={(event) => { event.preventDefault(); onSave(new FormData(event.currentTarget)) }}
      onKeyDown={(event) => { if (event.key === 'Escape') onCancel() }}
      className="grid gap-3 sm:grid-cols-2"
    >
      {prize.orderId ? (
        <p className="sm:col-span-2 text-[13px] text-black/60">
          <span className="font-semibold text-black">{prize.name}</span> is reserved from stock, so only how it is won can change here.
          To swap the watch, remove this prize and choose another.
          <input type="hidden" name="name" value={prize.name} />
          <input type="hidden" name="kind" value="WATCH" />
        </p>
      ) : (
        <>
          <label className="block sm:col-span-2"><span className={ui.label}>Prize</span>
            <input name="name" required autoFocus defaultValue={prize.name} className={ui.field} /></label>
          <label className="block"><span className={ui.label}>Type</span>
            <select name="kind" className={ui.field} defaultValue={prize.kind === 'WATCH' ? 'VOUCHER' : prize.kind}>
              {PRIZE_KINDS.filter((k) => k !== 'WATCH').map((k) => <option key={k} value={k}>{PRIZE_KIND_LABELS[k]}</option>)}
            </select></label>
          <label className="block"><span className={ui.label}>Value (AED)</span>
            <input name="value" inputMode="decimal" defaultValue={whole(prize.valueBase)} className={ui.field} placeholder="optional" /></label>
        </>
      )}
      <div className="sm:col-span-2">
        <span className={ui.label}>How it is won</span>
        <input type="hidden" name="rule" value={rule} />
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {([['RANK', 'Finishing position'], ['TARGET', 'Hitting a target']] as const).map(([key, title]) => (
            <button key={key} type="button" onClick={() => setRule(key)} aria-pressed={rule === key}
              className={`rounded-[12px] border bg-white p-3 text-left text-[13px] font-semibold text-black transition ${rule === key ? 'border-transparent ring-2' : 'border-black/10 hover:border-black/30'}`}
              style={rule === key ? { ['--tw-ring-color' as string]: 'var(--brand)' } : undefined}>
              {title}
            </button>
          ))}
        </div>
      </div>
      {rule === 'RANK' ? (
        <label className="block"><span className={ui.label}>Position</span>
          <select name="rank" className={ui.field} defaultValue={String(prize.rank ?? 1)}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{ordinal(n)} place</option>)}
          </select></label>
      ) : (
        <label className="block"><span className={ui.label}>Target {metricLabel.toLowerCase()} (AED)</span>
          <input name="target" inputMode="decimal" required defaultValue={whole(prize.targetBase)} className={ui.field} /></label>
      )}
      <div className="flex items-end justify-end gap-2">
        <button type="button" onClick={onCancel} className={ui.ghost}>Cancel</button>
        <button type="submit" disabled={busy} className={`${ui.primary} !h-10`} style={brandFill}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
