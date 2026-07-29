'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Circle, Clock3 } from 'lucide-react'
import { AnchoredMenu, Chip, useToast } from '@/components/ui'
import { RelativeTime } from '@/components/ui/RelativeTime'
import { completeTaskAction, snoozeTaskAction } from '@/app/actions/crm'
import { PRIORITY_LABELS, TASK_KIND_LABELS, type Priority, type TaskKind } from '@/lib/enums'
import { cn } from '@/lib/cn'

export interface AgendaTask {
  id: string
  title: string
  notes: string | null
  kind: string
  priority: string
  dueAt: Date | string | null
  customerId: string | null
  customerName: string | null
  watchId: string | null
  dealId: string | null
  stockNo: number | null
  assigneeName: string | null
}

const SNOOZE = [
  { days: 1, label: 'Tomorrow' },
  { days: 3, label: 'In three days' },
  { days: 7, label: 'Next week' },
  { days: 14, label: 'In a fortnight' },
]

/**
 * One thing to do, and everything needed to do it without leaving the page.
 *
 * The row is the unit of work on this screen, so it acts in place: the tick
 * completes, the clock snoozes, the links go to the person and the watch the
 * task is about. Nothing here opens a form. Working eight follow-ups should
 * cost eight keystrokes, and it does — `x` completes the focused row, `s`
 * snoozes it to tomorrow.
 *
 * Completion is optimistic with an undo rather than a confirmation. Ticking
 * the wrong row is a mistake people make several times a day and it costs
 * nothing to reverse; a dialog in front of the commonest action on the screen
 * costs something every single time.
 */
export function AgendaRow({ task, overdue }: { task: AgendaTask; overdue: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const snoozeTrigger = useRef<HTMLButtonElement>(null)
  const [pending, start] = useTransition()
  const [done, setDone] = useState(false)
  const [snoozing, setSnoozing] = useState(false)
  const [hidden, setHidden] = useState(false)

  const complete = () => {
    setDone(true)
    start(async () => {
      const result = await completeTaskAction(task.id, true)
      if (!result.ok) {
        setDone(false)
        toast.error('Could not tick that off', result.message)
        return
      }
      setHidden(true)
      toast.toast({
        tone: 'success',
        title: 'Done',
        description: task.title,
        action: {
          label: 'Undo',
          onClick: () => {
            setHidden(false)
            setDone(false)
            start(async () => {
              await completeTaskAction(task.id, false)
              router.refresh()
            })
          },
        },
      })
      router.refresh()
    })
  }

  const snooze = (days: number) => {
    setSnoozing(false)
    setHidden(true)
    start(async () => {
      const result = await snoozeTaskAction(task.id, days)
      if (!result.ok) {
        setHidden(false)
        toast.error('Could not snooze that', result.message)
        return
      }
      toast.success('Snoozed', result.message)
      router.refresh()
    })
  }

  if (hidden) return null

  const href = task.dealId ? `/pipeline/${task.dealId}`
    : task.customerId ? `/customers/${task.customerId}`
    : task.watchId ? `/inventory/${task.watchId}`
    : '/tasks'

  return (
    <li
      tabIndex={0}
      data-agenda-row
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'x') { event.preventDefault(); complete() }
        if (event.key === 's') { event.preventDefault(); snooze(1) }
        if (event.key === 'Enter') { event.preventDefault(); router.push(href) }
      }}
      className={cn(
        'group flex items-start gap-3 px-6 py-3 outline-none transition-colors',
        'hover:bg-surface-subtle focus-visible:bg-surface-subtle',
        pending && 'opacity-70',
      )}
    >
      <button
        type="button"
        onClick={complete}
        aria-label={`Mark "${task.title}" as done`}
        className="mt-0.5 shrink-0 rounded-pill text-content-secondary transition-colors hover:text-content-accent"
      >
        {done
          ? <Check className="h-5 w-5 text-content-accent" aria-hidden />
          : <Circle className="h-5 w-5" aria-hidden />}
      </button>

      <div className="min-w-0 flex-1">
        <Link href={href} className="block text-small font-bold text-content-primary hover:underline">
          {task.title}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-content-secondary">
          {task.customerName && task.customerId && (
            <Link href={`/customers/${task.customerId}`} className="font-semibold text-content-accent hover:underline">
              {task.customerName}
            </Link>
          )}
          {task.stockNo && task.watchId && (
            <Link href={`/inventory/${task.watchId}`} className="hover:underline">
              Stock {task.stockNo}
            </Link>
          )}
          <span>{TASK_KIND_LABELS[task.kind as TaskKind] ?? task.kind}</span>
          {task.priority !== 'NORMAL' && (
            <Chip tone={task.priority === 'URGENT' ? 'danger' : 'gold'}>
              {PRIORITY_LABELS[task.priority as Priority]}
            </Chip>
          )}
          {task.assigneeName && <span>{task.assigneeName}</span>}
        </p>
      </div>

      <span className={cn(
        'shrink-0 text-caption tabular-nums',
        overdue ? 'font-bold text-state-danger' : 'text-content-secondary',
      )}>
        {task.dueAt
          ? <RelativeTime value={new Date(task.dueAt).toISOString()} />
          : 'no date'}
      </span>

      <button
        ref={snoozeTrigger}
        type="button"
        onClick={() => setSnoozing((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={snoozing}
        aria-label={`Snooze "${task.title}"`}
        className="shrink-0 rounded-sm p-1 text-content-secondary opacity-0 transition-opacity hover:text-content-primary focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Clock3 className="h-4 w-4" aria-hidden />
      </button>

      <AnchoredMenu
        open={snoozing}
        onClose={() => setSnoozing(false)}
        anchorRef={snoozeTrigger}
        label="Snooze until"
        items={SNOOZE.map((option) => ({
          id: String(option.days),
          label: option.label,
          onSelect: () => snooze(option.days),
        }))}
      />
    </li>
  )
}
