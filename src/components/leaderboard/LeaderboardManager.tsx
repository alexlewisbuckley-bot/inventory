'use client'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useFormState, useFormStatus } from 'react-dom'
import {
  BarChart3, Camera, Check, Copy, ExternalLink, Gift, Link2, Pencil, Plus, Settings, Trash2, Trophy, Users,
} from 'lucide-react'
import {
  addAgentAction, addPrizeAction, agentPhotoAction, deleteLeaderboardAction, publishLeaderboardAction,
  removeAgentAction, removePrizeAction, saveLeaderboardAction, saveWeekAction, updateAgentAction,
  updatePrizeAction,
  type LeaderboardScope, type LeaderboardState,
} from '@/app/actions/leaderboards'
import { PRIZE_KINDS, PRIZE_KIND_LABELS } from '@/lib/enums'
import { weekStartOf, weeksOf } from '@/lib/leaderboard'
import { ui, brandFill } from '@/components/portal/ui'
import { LeaderboardBoard, ordinal, type BoardView } from './LeaderboardBoard'

const START: LeaderboardState = { ok: false, message: '' }
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
export function LeaderboardManager({ scope, board, id, shareToken, isPublished, photoBase, today, backHref }: {
  scope: LeaderboardScope
  board: BoardView
  id: string
  shareToken: string
  isPublished: boolean
  photoBase: string
  today: string
  backHref: string
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>(board.agents.length === 0 ? 'agents' : 'board')
  const [flash, setFlash] = useState<LeaderboardState | null>(null)
  const done = (result: LeaderboardState) => {
    setFlash(result)
    if (result.ok) router.refresh()
  }

  return (
    <div className="space-y-6">
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

      {tab === 'board' && <LeaderboardBoard board={board} photoBase={photoBase} today={today} />}
      {tab === 'figures' && <Figures scope={scope} id={id} board={board} today={today} onDone={done} />}
      {tab === 'agents' && <Agents scope={scope} id={id} board={board} photoBase={photoBase} onDone={done} />}
      {tab === 'prizes' && <Prizes scope={scope} id={id} board={board} onDone={done} />}
      {tab === 'settings' && (
        <SettingsTab scope={scope} id={id} board={board} shareToken={shareToken} isPublished={isPublished}
          onDone={done} backHref={backHref} />
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

function Prizes({ scope, id, board, onDone }: {
  scope: LeaderboardScope; id: string; board: BoardView; onDone: (r: LeaderboardState) => void
}) {
  const [state, action] = useFormState(addPrizeAction.bind(null, scope, id), START)
  const [rule, setRule] = useState<'RANK' | 'TARGET'>('RANK')
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState<string | null>(null)
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (!state.message) return
    onDone(state)
    if (state.ok) form.current?.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])
  const nextRank = Math.max(0, ...board.prizes.filter((p) => p.rule === 'RANK').map((p) => p.rank ?? 0)) + 1

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className={`${ui.card} divide-y divide-black/[0.06]`}>
        {board.prizes.length === 0 && <div className="p-6"><Empty>No prizes yet. Add what the agents are playing for alongside.</Empty></div>}
        {board.prizes.map((prize) => editing === prize.id ? (
          <div key={prize.id} className="bg-black/[0.015] p-4">
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
          <div key={prize.id} className="flex items-center gap-4 p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-[13px] font-semibold text-black/60">
              {prize.rule === 'RANK' ? ordinal(prize.rank!) : <Trophy className="h-4 w-4" aria-hidden />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14.5px] font-semibold text-black">{prize.name}</p>
              <p className="truncate text-[12.5px] text-black/45">
                {PRIZE_KIND_LABELS[prize.kind]}
                {prize.valueBase ? ` · worth ${aed(prize.valueBase)}` : ''}
                {' · '}
                {prize.rule === 'RANK' ? `for finishing ${ordinal(prize.rank!)}` : `for everyone reaching ${aed(prize.targetBase!)}`}
              </p>
            </div>
            <button type="button" disabled={pending} className={ui.iconButton} aria-label={`Edit ${prize.name}`}
              onClick={() => setEditing(prize.id)}>
              <Pencil className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" disabled={pending} className={ui.iconButton} aria-label={`Remove ${prize.name}`}
              onClick={() => start(async () => onDone(await removePrizeAction(scope, id, prize.id)))}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>

      <form ref={form} action={action} className={`${ui.card} space-y-3 p-5 lg:sticky lg:top-24 lg:self-start`}>
        <p className="text-[15px] font-semibold text-black">Add a prize</p>
        <label className="block"><span className={ui.label}>Prize</span>
          <input name="name" required className={ui.field} placeholder="e.g. Rolex Submariner 126610LN" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={ui.label}>Type</span>
            <select name="kind" className={ui.field} defaultValue="WATCH">
              {PRIZE_KINDS.map((k) => <option key={k} value={k}>{PRIZE_KIND_LABELS[k]}</option>)}
            </select></label>
          <label className="block"><span className={ui.label}>Value (AED)</span>
            <input name="value" inputMode="decimal" className={ui.field} placeholder="optional" /></label>
        </div>

        <div>
          <span className={ui.label}>How it is won</span>
          <input type="hidden" name="rule" value={rule} />
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {([['RANK', 'Finishing position', '1st, 2nd, 3rd…'], ['TARGET', 'Hitting a target', 'Everyone who reaches it']] as const).map(([key, title, sub]) => (
              <button key={key} type="button" onClick={() => setRule(key)} aria-pressed={rule === key}
                className={`rounded-[12px] border p-3 text-left transition ${rule === key ? 'border-transparent ring-2' : 'border-black/10 hover:border-black/30'}`}
                style={rule === key ? { ['--tw-ring-color' as string]: 'var(--brand)' } : undefined}>
                <span className="block text-[13px] font-semibold text-black">{title}</span>
                <span className="block text-[11.5px] text-black/45">{sub}</span>
              </button>
            ))}
          </div>
        </div>

        {rule === 'RANK' ? (
          <label className="block"><span className={ui.label}>Position</span>
            <select name="rank" className={ui.field} defaultValue={String(nextRank)} key={nextRank}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{ordinal(n)} place</option>)}
            </select></label>
        ) : (
          <label className="block"><span className={ui.label}>Target {board.metricLabel.toLowerCase()} (AED)</span>
            <input name="target" inputMode="decimal" required className={ui.field} placeholder="e.g. 500000" /></label>
        )}
        <Submit label="Add prize" />
      </form>
    </div>
  )
}

function SettingsTab({ scope, id, board, shareToken, isPublished, onDone, backHref }: {
  scope: LeaderboardScope; id: string; board: BoardView; shareToken: string; isPublished: boolean
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
          <button type="button" role="switch" aria-checked={isPublished} disabled={pending}
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
type Prize = BoardView['prizes'][number]

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
  prize: Prize; metricLabel: string; busy: boolean
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
      <label className="block sm:col-span-2"><span className={ui.label}>Prize</span>
        <input name="name" required autoFocus defaultValue={prize.name} className={ui.field} /></label>
      <label className="block"><span className={ui.label}>Type</span>
        <select name="kind" className={ui.field} defaultValue={prize.kind}>
          {PRIZE_KINDS.map((k) => <option key={k} value={k}>{PRIZE_KIND_LABELS[k]}</option>)}
        </select></label>
      <label className="block"><span className={ui.label}>Value (AED)</span>
        <input name="value" inputMode="decimal" defaultValue={whole(prize.valueBase)} className={ui.field} placeholder="optional" /></label>
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
