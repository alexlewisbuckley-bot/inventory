'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarDays, ChevronDown, Clock, Inbox } from 'lucide-react'
import { Card } from '@/components/ui'
import { RelativeTime } from '@/components/ui/RelativeTime'
import { AgendaRow, type AgendaTask } from './AgendaRow'
import { cn } from '@/lib/cn'

export interface WaitingItem {
  id: string
  title: string
  who: string | null
  since: string
  /**
   * Already formatted.
   *
   * The page holds the reader's display currency and the rate table; this is a
   * client component. Passing the formatter across that boundary is not
   * possible — a function cannot be serialised — and passing the rate table
   * across it would put currency conversion in the browser, where it would
   * disagree with every server-rendered figure the moment a rate changed.
   */
  amount: string | null
  href: string
}

/**
 * The agenda is the screen.
 *
 * Three bands, not one sorted list. Overdue is a promise already broken; due
 * today is a promise still keepable; waiting on them is not yours to do at
 * all. Merging them into a date-ordered list makes the reader perform that
 * separation themselves every morning before they can start, and the whole
 * point of this screen is that the work has already been sorted for you.
 *
 * `j` and `k` move between rows without leaving the keyboard, which — with `x`
 * and `s` on the row itself — is what makes eight follow-ups cost eight
 * keystrokes.
 */
export function Agenda({ overdue, today, undated, waiting, quiet }: {
  overdue: AgendaTask[]
  today: AgendaTask[]
  undated: AgendaTask[]
  waiting: WaitingItem[]
  quiet: { movingDeals: number; held: number }
}) {
  const container = useRef<HTMLDivElement>(null)

  // j/k, scoped to this screen and disabled while typing. Handled here rather
  // than on the row so the keys move *between* rows — a row can only ever
  // handle its own.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'j' && event.key !== 'k') return
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const rows = [...(container.current?.querySelectorAll<HTMLElement>('[data-agenda-row]') ?? [])]
      if (rows.length === 0) return
      const current = rows.indexOf(document.activeElement as HTMLElement)
      const next = event.key === 'j'
        ? Math.min(current + 1, rows.length - 1)
        : Math.max(current - 1, 0)
      event.preventDefault()
      rows[current === -1 ? 0 : next]?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const nothing = overdue.length === 0 && today.length === 0
    && undated.length === 0 && waiting.length === 0

  if (nothing) {
    // A clear agenda is a good day, not a broken screen, and it should read
    // like one. An empty state that apologises teaches people the screen is
    // unreliable.
    return (
      <Card as="section">
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <Inbox className="h-6 w-6 text-content-accent" aria-hidden />
          <p className="text-h3 font-extrabold text-content-primary">Nothing due.</p>
          <p className="max-w-md text-small text-content-secondary">
            {quiet.movingDeals} {quiet.movingDeals === 1 ? 'deal has' : 'deals have'} moved this week
            and {quiet.held} {quiet.held === 1 ? 'watch is' : 'watches are'} held.
            Good time to ring somebody who has gone quiet.
          </p>
        </div>
      </Card>
    )
  }

  return (
    <div ref={container} className="flex flex-col gap-4">
      <Band
        title="Overdue"
        tone="danger"
        icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
        count={overdue.length}
      >
        {overdue.map((task) => <AgendaRow key={task.id} task={task} overdue />)}
      </Band>

      <Band
        title="Due today"
        tone="accent"
        icon={<CalendarDays className="h-4 w-4" aria-hidden />}
        count={today.length}
      >
        {today.map((task) => <AgendaRow key={task.id} task={task} overdue={false} />)}
      </Band>

      <Band
        title="Waiting on them"
        tone="neutral"
        icon={<Clock className="h-4 w-4" aria-hidden />}
        count={waiting.length}
        description="Generated, not entered — offers with no reply, deals that have stopped moving, invoices past their terms."
      >
        {waiting.map((item) => (
          <li key={item.id} className="flex items-start gap-3 px-6 py-3 transition-colors hover:bg-surface-subtle">
            <div className="min-w-0 flex-1">
              <Link href={item.href} className="block text-small font-bold text-content-primary hover:underline">
                {item.title}
              </Link>
              <p className="mt-0.5 text-caption text-content-secondary">
                {item.who ? `${item.who} · ` : ''}
                since <RelativeTime value={item.since} />
              </p>
            </div>
            {item.amount && (
              <span className="shrink-0 text-small font-bold tabular-nums text-content-primary">
                {item.amount}
              </span>
            )}
          </li>
        ))}
      </Band>

      <Band
        title="No date"
        tone="neutral"
        icon={<Inbox className="h-4 w-4" aria-hidden />}
        count={undated.length}
        description="Promised, but never scheduled. These are the ones that quietly never happen."
        collapsedByDefault
      >
        {undated.map((task) => <AgendaRow key={task.id} task={task} overdue={false} />)}
      </Band>
    </div>
  )
}

/**
 * A collapsible band.
 *
 * Absent rather than empty when it has nothing in it: a band headed "Overdue ·
 * 0" is a line of furniture that has to be read and dismissed every morning.
 */
function Band({ title, tone, icon, count, description, collapsedByDefault, children }: {
  title: string
  tone: 'danger' | 'accent' | 'neutral'
  icon: React.ReactNode
  count: number
  description?: string
  collapsedByDefault?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(!collapsedByDefault)
  if (count === 0) return null

  return (
    <Card as="section">
      <div className="flex items-start justify-between gap-3 border-b border-line-subtle px-6 py-3.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <span className={cn(
            'shrink-0',
            tone === 'danger' ? 'text-state-danger'
              : tone === 'accent' ? 'text-content-accent'
              : 'text-content-secondary',
          )}>
            {icon}
          </span>
          <span className="text-micro font-semibold uppercase tracking-wide text-content-secondary">
            {title}
          </span>
          <span className={cn(
            'text-micro font-bold tabular-nums',
            tone === 'danger' ? 'text-state-danger' : 'text-content-primary',
          )}>
            {count}
          </span>
          <ChevronDown
            className={cn('h-3.5 w-3.5 shrink-0 text-content-secondary transition-transform', !open && '-rotate-90')}
            aria-hidden
          />
        </button>
        {description && open && (
          <p className="hidden max-w-sm text-right text-caption text-content-secondary sm:block">
            {description}
          </p>
        )}
      </div>
      {open && <ul className="divide-y divide-line-subtle">{children}</ul>}
    </Card>
  )
}
