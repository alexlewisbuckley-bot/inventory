'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { Clock, PauseCircle } from 'lucide-react'
import { Button, Card, Chip, Modal, TextField, useCurrency, useToast } from '@/components/ui'
import { releaseHoldAction, completeOrderAction } from '@/app/actions/partners'
import type { ActionState } from '@/app/actions/auth'
import { percentFromBps } from '@/lib/partner-rate'

export interface HeldView {
  orderId: string
  watchId: string
  stockNo: number
  brandName: string
  model: string | null
  modelName: string | null
  partnerName: string
  placedAt: string
  placedByName: string | null
  placedByEmail: string | null
  note: string | null
  priceAtOrder: number
  askingAtOrder: number
  discountBpsAtOrder: number
}

const INITIAL: ActionState = { ok: false }

/** Whole days since a hold was placed, on the clock a person reads. */
function daysSince(iso: string): number {
  const then = new Date(iso).getTime()
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000))
}

/**
 * What is on hold for a partner, and the button that lets it go.
 *
 * A hold never expires on its own, which was the decision — a watch should
 * not come back on offer in the middle of a conversation nobody here knew was
 * running. The cost of that decision is this list: without somewhere the
 * holds are visible and ageing, a piece sits off the market for six weeks
 * because a thread went quiet in March.
 *
 * Oldest first, which is the opposite of nearly every other list here.
 * Newest-first is right for things that happened; this is a list of things
 * that have NOT happened, so the top of it should be whatever has been
 * waiting longest.
 */
export function HeldStock({ rows, canManage }: { rows: HeldView[]; canManage: boolean }) {
  const { money } = useCurrency()
  const toast = useToast()
  const [releasing, setReleasing] = useState<HeldView | null>(null)
  const [busy, setBusy] = useState(false)

  if (rows.length === 0) return null

  const close = async (row: HeldView) => {
    setBusy(true)
    const result = await completeOrderAction(row.orderId)
    setBusy(false)
    if (result.ok) toast.success('Order closed')
    else toast.error('Could not close that order', result.message)
  }

  return (
    <>
      <Card className="mb-6">
        <div className="flex items-center gap-2.5 border-b border-line-subtle px-5 py-4">
          <PauseCircle className="h-4 w-4 text-content-secondary" aria-hidden />
          <p className="text-body font-bold text-content-primary">
            On hold for a partner
          </p>
          <Chip tone="neutral">{rows.length}</Chip>
          <p className="ml-auto hidden text-small text-content-secondary sm:block">
            Off the market until somebody here moves it on or releases it.
          </p>
        </div>

        <ul className="divide-y divide-line-subtle">
          {rows.map((row) => {
            const days = daysSince(row.placedAt)
            return (
              <li key={row.orderId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body text-content-primary">
                    <Link href={`/inventory/${row.watchId}`} className="font-semibold hover:underline">
                      {[row.brandName, row.model, row.modelName].filter(Boolean).join(' ')}
                    </Link>
                    <span className="ml-2 text-small text-content-secondary">#{row.stockNo}</span>
                  </p>
                  <p className="truncate text-small text-content-secondary">
                    {row.partnerName}
                    {row.placedByName && ` · ${row.placedByName}`}
                    {row.placedByEmail && ` · ${row.placedByEmail}`}
                  </p>
                  {row.note && <p className="truncate text-small text-content-secondary">{row.note}</p>}
                </div>

                <div className="text-right">
                  <p className="text-body font-bold tabular-nums text-content-primary">
                    {money(row.priceAtOrder)}
                  </p>
                  <p className="text-caption text-content-secondary">
                    {percentFromBps(row.discountBpsAtOrder)} off {money(row.askingAtOrder)}
                  </p>
                </div>

                {/*
                 * The age, flagged past a fortnight.
                 *
                 * Not an expiry — nothing happens automatically. It is the
                 * prompt to pick up the phone, which is the only thing that
                 * ends a hold here.
                 */}
                <p className={`flex items-center gap-1.5 text-small tabular-nums ${
                  days >= 14 ? 'font-semibold text-state-warning' : 'text-content-secondary'
                }`}>
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  {days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`}
                </p>

                {canManage && (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => void close(row)} disabled={busy}>
                      Sold
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setReleasing(row)}>
                      Release
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </Card>

      {releasing && (
        <ReleaseForm
          row={releasing}
          onDone={() => setReleasing(null)}
          onReleased={() => toast.success('Released', 'The watch is back on the market.')}
        />
      )}
    </>
  )
}

function ReleaseForm({ row, onDone, onReleased }: {
  row: HeldView
  onDone: () => void
  onReleased: () => void
}) {
  const [state, action] = useFormState(releaseHoldAction, INITIAL)

  if (state.ok) {
    onReleased()
    onDone()
  }

  return (
    <Modal open title={`Release ${row.brandName} ${row.model ?? ''}`.trim()} onClose={onDone}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="orderId" value={row.orderId} />
        <p className="text-small text-content-secondary">
          The watch goes back into stock and onto every list it was on before.{' '}
          <span className="font-semibold text-content-primary">{row.partnerName}</span> is not
          told — if somebody should hear about it, that is a phone call, not an email from here.
        </p>
        <TextField
          name="reason"
          label="Why (optional)"
          hint="For the audit and for whoever asks about it next month."
        />
        {state.message && !state.ok && (
          <p role="alert" className="text-small text-state-danger">{state.message}</p>
        )}
        <div className="flex justify-end gap-2.5">
          <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
          <Release />
        </div>
      </form>
    </Modal>
  )
}

function Release() {
  const { pending } = useFormStatus()
  return <Button type="submit" variant="danger" loading={pending}>Release the hold</Button>
}
