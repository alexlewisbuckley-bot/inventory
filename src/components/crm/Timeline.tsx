'use client'

import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import {
  ArrowRightLeft, Banknote, CalendarCheck, FileText, Mail, MessageCircle,
  Phone, ReceiptText, Send, StickyNote, Video, Zap,
} from 'lucide-react'
import { Button, Chip, SelectField, TextField, useToast } from '@/components/ui'
import { RelativeTime } from '@/components/ui/RelativeTime'
import { logActivityAction } from '@/app/actions/crm'
import { ACTIVITY_TYPE_LABELS, LOGGABLE_ACTIVITY_TYPES, type ActivityType } from '@/lib/enums'
import { formatDateTime } from '@/lib/dates'
import { cn } from '@/lib/cn'
import type { ActionState } from '@/app/actions/auth'

const INITIAL: ActionState = { ok: false }

export interface TimelineItem {
  id: string
  type: string
  direction: string
  subject: string | null
  body: string | null
  occurredAt: Date | string
  durationMin: number | null
  isSystem: boolean
  actorName: string | null
}

const ICONS: Record<string, typeof Phone> = {
  CALL: Phone,
  EMAIL: Mail,
  WHATSAPP: MessageCircle,
  SMS: MessageCircle,
  MEETING: CalendarCheck,
  VIDEO: Video,
  NOTE: StickyNote,
  OFFER: Send,
  STAGE_CHANGE: ArrowRightLeft,
  PURCHASE: Banknote,
  SALE: ReceiptText,
  VALUATION: FileText,
  SYSTEM: Zap,
}

/**
 * The relationship, in order.
 *
 * One feed rather than one per channel: what matters when you pick up the
 * phone is what happened last, not what happened last *by email*. System
 * events are rendered quieter than conversations so a real exchange still
 * reads as the important thing on the page.
 */
export function Timeline({ items, scope, canLog = true }: {
  items: TimelineItem[]
  scope: { customerId?: string; supplierId?: string; watchId?: string; dealId?: string; requestId?: string }
  canLog?: boolean
}) {
  return (
    <div className="flex flex-col">
      {canLog && <LogForm scope={scope} />}

      {items.length === 0 ? (
        <p className="px-6 py-8 text-center text-small text-content-secondary">
          Nothing logged yet. Every call, message and note you record here builds the history.
        </p>
      ) : (
        <ol className="relative px-6 pb-6 pt-2">
          {items.map((item, index) => {
            const Icon = ICONS[item.type] ?? StickyNote
            const last = index === items.length - 1
            return (
              <li key={item.id} className="relative flex gap-3.5 pb-5 last:pb-0">
                {/* The rail stops at the last item rather than running into
                    whitespace below it. */}
                {!last && (
                  <span className="absolute left-[15px] top-8 bottom-0 w-px bg-line-subtle" aria-hidden />
                )}
                <span
                  className={cn(
                    'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-pill',
                    item.isSystem
                      ? 'bg-surface-subtle text-content-secondary'
                      : 'bg-teal-100 text-content-accent',
                  )}
                  aria-hidden
                >
                  <Icon className="h-4 w-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <p className={cn(
                      'min-w-0 text-small font-bold',
                      item.isSystem ? 'text-content-secondary' : 'text-content-primary',
                    )}>
                      {item.subject || ACTIVITY_TYPE_LABELS[item.type as ActivityType] || item.type}
                    </p>
                    {!item.isSystem && (
                      <Chip tone="neutral">{ACTIVITY_TYPE_LABELS[item.type as ActivityType] ?? item.type}</Chip>
                    )}
                    {item.direction === 'INBOUND' && <Chip tone="accent">Inbound</Chip>}
                  </div>

                  {item.body && (
                    <p className="mt-1 whitespace-pre-wrap text-small text-content-secondary">{item.body}</p>
                  )}

                  <p className="mt-1 text-caption text-content-secondary" title={formatDateTime(item.occurredAt)}>
                    {item.actorName ?? 'System'} · <RelativeTime value={item.occurredAt as string} />
                    {item.durationMin ? ` · ${item.durationMin} min` : ''}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

/**
 * Logging a conversation, inline.
 *
 * Collapsed to a single line until it is needed. A form that is always open
 * pushes the history down the page, and the history is what people came for;
 * a form behind a modal makes logging a two-minute call feel like paperwork.
 */
function LogForm({ scope }: { scope: Record<string, string | undefined> }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<ActivityType>('NOTE')
  const [state, action] = useFormState(logActivityAction, INITIAL)

  // Collapse after a successful save so the history is visible again. In an
  // effect rather than during render: a toast is a side effect, and firing one
  // from a render body double-fires it under strict mode.
  useEffect(() => {
    if (!state.ok) return
    setOpen(false)
    toast.success('Logged')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  if (!open) {
    return (
      <div className="border-b border-line-subtle px-6 py-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-11 w-full items-center gap-2.5 rounded-md border border-dashed border-line-strong px-3.5 text-left text-small text-content-secondary transition-colors hover:border-teal-500 hover:text-content-primary"
        >
          <StickyNote className="h-4 w-4" aria-hidden />
          Log a call, message or note…
        </button>
      </div>
    )
  }

  return (
    <form action={action} className="border-b border-line-subtle px-6 py-4">
      {Object.entries(scope).map(([key, value]) =>
        value ? <input key={key} type="hidden" name={key} value={value} /> : null)}

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          name="type"
          label="What happened"
          value={type}
          onChange={(event) => setType(event.target.value as ActivityType)}
          options={LOGGABLE_ACTIVITY_TYPES.map((value) => ({
            value, label: ACTIVITY_TYPE_LABELS[value],
          }))}
        />
        <SelectField
          name="direction"
          label="Direction"
          defaultValue="OUTBOUND"
          options={[
            { value: 'OUTBOUND', label: 'We contacted them' },
            { value: 'INBOUND', label: 'They contacted us' },
            { value: 'INTERNAL', label: 'Internal note' },
          ]}
        />
        <TextField
          name="subject"
          label="Summary"
          placeholder="One line you would recognise in a list"
          className="sm:col-span-2"
          error={state.errors?.subject}
        />
        <div className="sm:col-span-2">
          <label htmlFor="activity-body" className="text-caption font-semibold text-content-secondary">
            Detail
          </label>
          <textarea
            id="activity-body"
            name="body"
            rows={3}
            placeholder="What was said, and what happens next."
            className="mt-1.5 w-full rounded-md border border-line-subtle bg-surface-raised px-3.5 py-3 text-body text-content-primary placeholder:text-content-secondary"
          />
        </div>
        {type === 'CALL' && (
          <TextField name="durationMin" label="Minutes" inputMode="numeric" placeholder="15" />
        )}
      </div>

      {state.message && !state.ok && (
        <p role="alert" className="mt-3 text-small text-state-danger">{state.message}</p>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Button>
        <SaveButton />
      </div>
    </form>
  )
}

function SaveButton() {
  const { pending } = useFormStatus()
  return <Button type="submit" loading={pending}>Log it</Button>
}
