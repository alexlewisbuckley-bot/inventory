'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Circle, ListChecks } from 'lucide-react'
import { Card, Chip, EmptyState, useToast } from '@/components/ui'
import { RelativeTime } from '@/components/ui/RelativeTime'
import { completeTaskAction } from '@/app/actions/crm'
import { PRIORITY_LABELS, TASK_KIND_LABELS, type Priority, type TaskKind } from '@/lib/enums'
import { formatDateTime } from '@/lib/dates'
import { cn } from '@/lib/cn'
import type { TaskRow } from '@/server/repositories/crm-repository'

/**
 * Follow-ups, grouped by when they are due.
 *
 * Overdue first, then today, then the rest. A flat list sorted by date reads
 * as one long backlog; the grouping is what turns it into "these three, now".
 */
export function TaskList({ tasks, canComplete }: { tasks: TaskRow[]; canComplete: boolean }) {
  const now = Date.now()
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)

  const open = tasks.filter((task) => task.status === 'OPEN')
  const done = tasks.filter((task) => task.status === 'DONE')

  const groups = [
    { key: 'overdue', title: 'Overdue', tone: 'danger' as const, items: open.filter((t) => t.dueAt && t.dueAt.getTime() < now && t.dueAt.getTime() < endOfToday.getTime() && t.dueAt.getTime() < new Date().setHours(0, 0, 0, 0)) },
    { key: 'today', title: 'Today', tone: 'accent' as const, items: open.filter((t) => t.dueAt && t.dueAt.getTime() >= new Date().setHours(0, 0, 0, 0) && t.dueAt.getTime() <= endOfToday.getTime()) },
    { key: 'later', title: 'Coming up', tone: 'neutral' as const, items: open.filter((t) => t.dueAt && t.dueAt.getTime() > endOfToday.getTime()) },
    { key: 'undated', title: 'No date', tone: 'neutral' as const, items: open.filter((t) => !t.dueAt) },
  ].filter((group) => group.items.length > 0)

  if (open.length === 0 && done.length === 0) {
    return (
      <EmptyState
        icon={<ListChecks className="h-6 w-6" />}
        title="Nothing to follow up"
        description="Tasks appear here when you add one, and automatically when a deal is won or an offer goes unanswered."
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <Card key={group.key} as="section">
          <div className="flex items-baseline justify-between gap-3 border-b border-line-subtle px-6 py-4">
            <h2 className="flex items-center gap-2 text-small font-bold text-content-primary">
              {group.title}
              <Chip tone={group.tone}>{group.items.length}</Chip>
            </h2>
          </div>
          <ul className="divide-y divide-line-subtle">
            {group.items.map((task) => (
              <TaskRowView key={task.id} task={task} canComplete={canComplete} overdue={group.key === 'overdue'} />
            ))}
          </ul>
        </Card>
      ))}

      {done.length > 0 && (
        <Card as="section">
          <div className="border-b border-line-subtle px-6 py-4">
            <h2 className="text-small font-bold text-content-secondary">Done recently</h2>
          </div>
          <ul className="divide-y divide-line-subtle">
            {done.slice(0, 10).map((task) => (
              <TaskRowView key={task.id} task={task} canComplete={canComplete} overdue={false} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function TaskRowView({ task, canComplete, overdue }: {
  task: TaskRow
  canComplete: boolean
  overdue: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()
  const [done, setDone] = useState(task.status === 'DONE')

  const toggle = () => {
    if (!canComplete) return
    const next = !done
    // Optimistic: ticking a task is the most repeated action on this page and
    // it has to feel instant.
    setDone(next)
    start(async () => {
      const result = await completeTaskAction(task.id, next)
      if (!result.ok) {
        setDone(!next)
        toast.error('Could not update the task', result.message)
      }
      router.refresh()
    })
  }

  return (
    <li className={cn('flex items-start gap-3 px-6 py-3.5', pending && 'opacity-70')}>
      <button
        type="button"
        onClick={toggle}
        disabled={!canComplete}
        aria-pressed={done}
        aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} as done`}
        className="mt-0.5 shrink-0 rounded-pill text-content-secondary transition-colors hover:text-content-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {done
          ? <CheckCircle2 className="h-5 w-5 text-content-accent" aria-hidden />
          : <Circle className="h-5 w-5" aria-hidden />}
      </button>

      <div className="min-w-0 flex-1">
        <p className={cn('text-small font-bold', done ? 'text-content-secondary line-through' : 'text-content-primary')}>
          {task.title}
        </p>
        {task.notes && <p className="mt-0.5 text-caption text-content-secondary">{task.notes}</p>}

        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-content-secondary">
          <span className={overdue ? 'font-bold text-state-danger' : undefined}
            title={task.dueAt ? formatDateTime(task.dueAt) : undefined}>
            {task.dueAt ? <>due <RelativeTime value={task.dueAt.toISOString()} /></> : 'no date'}
          </span>
          <span aria-hidden>·</span>
          <span>{TASK_KIND_LABELS[task.kind as TaskKind] ?? task.kind}</span>
          {task.priority !== 'NORMAL' && (
            <Chip tone={task.priority === 'URGENT' ? 'danger' : 'gold'}>
              {PRIORITY_LABELS[task.priority as Priority]}
            </Chip>
          )}
          {task.customerId && (
            <Link href={`/customers/${task.customerId}`} className="font-semibold text-content-accent hover:underline">
              {task.customerName}
            </Link>
          )}
          {task.watchId && (
            <Link href={`/inventory/${task.watchId}`} className="font-semibold text-content-accent hover:underline">
              Stock {task.stockNo}
            </Link>
          )}
        </p>
      </div>

      {task.assigneeName && (
        <span className="shrink-0 text-caption text-content-secondary">{task.assigneeName}</span>
      )}
    </li>
  )
}
