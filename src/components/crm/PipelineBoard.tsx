'use client'

import { useMemo, useOptimistic, useState, useTransition, type DragEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarDays, GripVertical, Plus, Watch } from 'lucide-react'
import {
  Avatar, Button, Card, Chip, Modal, TextField, ToolbarRow, ToolbarSearch,
  ToolbarSelect, useCurrency, useToast,
} from '@/components/ui'
import { useListQuery } from '@/hooks/useListQuery'
import { moveDealAction } from '@/app/actions/crm'
import { DEAL_STAGE_LABELS, OPEN_DEAL_STAGES, type DealStage } from '@/lib/enums'
import { formatDate } from '@/lib/dates'
import { cn } from '@/lib/cn'
import type { DealCard } from '@/server/repositories/crm-repository'

/**
 * The pipeline.
 *
 * A board rather than a list because the question it answers is "what is the
 * shape of the month", and shape is spatial. Only the open stages get a column:
 * won and lost are outcomes, not places work sits, and giving them columns is
 * how a board turns into an archive nobody scrolls past.
 *
 * The move is optimistic. Dragging a card and waiting for a round trip before
 * it lands is the single thing that makes a board feel broken, so the card
 * moves immediately and the server correction — if there is one — arrives with
 * the refresh.
 */
export function PipelineBoard({ deals, owners, canEdit }: {
  deals: DealCard[]
  owners: Array<{ id: string; name: string; initials: string }>
  canEdit: boolean
}) {
  const query = useListQuery()
  const router = useRouter()
  const toast = useToast()
  const { money } = useCurrency()
  const [, startTransition] = useTransition()

  const [optimistic, moveOptimistically] = useOptimistic(
    deals,
    (current: DealCard[], move: { id: string; stage: DealStage }) =>
      current.map((deal) => (deal.id === move.id ? { ...deal, stage: move.stage } : deal)),
  )

  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<DealStage | null>(null)
  const [losing, setLosing] = useState<DealCard | null>(null)

  const columns = useMemo(() => OPEN_DEAL_STAGES.map((stage) => {
    const items = optimistic.filter((deal) => deal.stage === stage)
    return {
      stage,
      items,
      value: items.reduce((sum, deal) => sum + (deal.valueGbp ?? 0), 0),
    }
  }), [optimistic])

  const won = optimistic.filter((deal) => deal.stage === 'WON')
  const lost = optimistic.filter((deal) => deal.stage === 'LOST')

  const move = (deal: DealCard, stage: DealStage) => {
    if (deal.stage === stage) return
    // Losing a deal requires a reason, so it asks rather than silently moving.
    if (stage === 'LOST') { setLosing(deal); return }

    startTransition(async () => {
      moveOptimistically({ id: deal.id, stage })
      const result = await moveDealAction(deal.id, stage)
      if (!result.ok) toast.error('Could not move the deal', result.message)
      router.refresh()
    })
  }

  const onDrop = (event: DragEvent, stage: DealStage) => {
    event.preventDefault()
    setOver(null)
    const id = event.dataTransfer.getData('text/plain') || dragging
    const deal = optimistic.find((d) => d.id === id)
    setDragging(null)
    if (deal) move(deal, stage)
  }

  return (
    <>
      <ToolbarRow className="mb-5">
        <ToolbarSearch
          value={query.get('q') ?? ''}
          onChange={(value) => query.set('q', value || null)}
          label="Search deals"
          placeholder="Deal, customer or stock number…"
          className="min-w-[260px]"
        />
        <ToolbarSelect
          label="Owner"
          value={query.get('ownerId') ?? ''}
          onChange={(value) => query.set('ownerId', value || null)}
          options={owners.map((o) => ({ value: o.id, label: o.name }))}
        />
      </ToolbarRow>

      {/* One horizontal scroller for the whole board: columns keep a readable
          width instead of being squeezed to fit, which is what makes a
          seven-stage pipeline unusable on a laptop. */}
      {/* The scroller is width-constrained explicitly. A board wider than the
          viewport must scroll inside its own box; letting it push the document
          sideways drags the sidebar and the header out of view with it. */}
      <div className="overflow-hidden">
        <div className="scroll-region w-full overflow-x-auto pb-3">
          <div className="flex w-max gap-4">
          {columns.map((column) => (
            <section
              key={column.stage}
              onDragOver={(event) => { event.preventDefault(); setOver(column.stage) }}
              onDragLeave={() => setOver((s) => (s === column.stage ? null : s))}
              onDrop={(event) => onDrop(event, column.stage)}
              className={cn(
                'flex w-[286px] shrink-0 flex-col rounded-lg border bg-surface-subtle/60 transition-colors',
                over === column.stage ? 'border-teal-500 bg-teal-100/40' : 'border-line-subtle',
              )}
            >
              <header className="flex items-baseline justify-between gap-2 px-3.5 pb-2 pt-3.5">
                <h2 className="text-small font-bold text-content-primary">
                  {DEAL_STAGE_LABELS[column.stage]}
                </h2>
                <span className="shrink-0 text-caption tabular-nums text-content-secondary">
                  {column.items.length}
                </span>
              </header>
              <p className="px-3.5 pb-3 text-caption tabular-nums text-content-secondary">
                {column.value > 0 ? money(column.value) : '—'}
              </p>

              <div className="flex min-h-[80px] flex-1 flex-col gap-2 px-2.5 pb-3">
                {column.items.length === 0 && (
                  <p className="px-1 py-4 text-center text-caption text-content-secondary">
                    Nothing here
                  </p>
                )}
                {column.items.map((deal) => (
                  <DealCardView
                    key={deal.id}
                    deal={deal}
                    canEdit={canEdit}
                    dragging={dragging === deal.id}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', deal.id)
                      event.dataTransfer.effectAllowed = 'move'
                      setDragging(deal.id)
                    }}
                    onDragEnd={() => { setDragging(null); setOver(null) }}
                    onMove={(stage) => move(deal, stage)}
                    money={money}
                  />
                ))}
              </div>
            </section>
          ))}
          </div>
        </div>
      </div>

      {(won.length > 0 || lost.length > 0) && (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Closed title="Won" tone="success" deals={won} money={money} />
          <Closed title="Lost" tone="danger" deals={lost} money={money} />
        </div>
      )}

      <LostDialog
        deal={losing}
        onClose={() => setLosing(null)}
        onConfirm={(reason) => {
          const deal = losing
          setLosing(null)
          if (!deal) return
          startTransition(async () => {
            moveOptimistically({ id: deal.id, stage: 'LOST' })
            const result = await moveDealAction(deal.id, 'LOST', { lostReason: reason })
            if (!result.ok) toast.error('Could not close the deal', result.message)
            router.refresh()
          })
        }}
      />
    </>
  )
}

function DealCardView({ deal, canEdit, dragging, onDragStart, onDragEnd, onMove, money }: {
  deal: DealCard
  canEdit: boolean
  dragging: boolean
  onDragStart: (event: DragEvent) => void
  onDragEnd: () => void
  onMove: (stage: DealStage) => void
  money: (value: number | null) => string
}) {
  const overdue = deal.expectedClose !== null && new Date(deal.expectedClose) < new Date()

  return (
    <article
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'group rounded-md border border-line-subtle bg-surface-raised p-3 shadow-sm transition-opacity',
        canEdit && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-2">
        {canEdit && (
          <GripVertical
            className="mt-0.5 h-4 w-4 shrink-0 text-content-secondary opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1">
          {/* The card links to the deal, not to the customer. It linked to the
              customer only because the deal had no record to link to, which
              meant clicking a deal took you somewhere that could not tell you
              what had happened on it. */}
          <Link
            href={`/pipeline/${deal.id}`}
            className="block text-small font-bold text-content-primary hover:underline"
          >
            {deal.title}
          </Link>
          {deal.customerName && deal.customerId && (
            <Link
              href={`/customers/${deal.customerId}`}
              className="mt-0.5 block truncate text-caption text-content-secondary hover:text-content-accent hover:underline"
            >
              {deal.customerName}
            </Link>
          )}
        </div>
        {deal.ownerInitials && (
          <Avatar initials={deal.ownerInitials} id={deal.ownerId ?? deal.id} size="sm" />
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="text-small font-bold tabular-nums text-content-primary">
          {money(deal.valueGbp)}
        </span>
        <span className="text-caption tabular-nums text-content-secondary">{deal.probability}%</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {deal.stockNo && (
          <Chip tone="neutral">
            <Watch className="mr-1 h-3 w-3" aria-hidden />
            {deal.stockNo}
          </Chip>
        )}
        {deal.expectedClose && (
          <span className={cn(
            'inline-flex items-center gap-1 text-caption',
            overdue ? 'text-state-danger' : 'text-content-secondary',
          )}>
            <CalendarDays className="h-3 w-3" aria-hidden />
            {formatDate(deal.expectedClose)}
          </span>
        )}
        {deal.overdueTasks > 0 && <Chip tone="danger">{deal.overdueTasks} overdue</Chip>}
      </div>

      {/* Keyboard and touch both need a way through that is not a drag. */}
      {canEdit && (
        <label className="mt-2.5 block">
          <span className="sr-only">Move {deal.title} to another stage</span>
          <select
            value={deal.stage}
            onChange={(event) => onMove(event.target.value as DealStage)}
            className="h-8 w-full cursor-pointer rounded-sm border border-line-subtle bg-surface-subtle px-2 text-caption font-semibold text-content-secondary transition-colors hover:border-line-strong"
          >
            {OPEN_DEAL_STAGES.map((stage) => (
              <option key={stage} value={stage}>{DEAL_STAGE_LABELS[stage]}</option>
            ))}
            <option value="WON">{DEAL_STAGE_LABELS.WON}</option>
            <option value="LOST">{DEAL_STAGE_LABELS.LOST}</option>
          </select>
        </label>
      )}
    </article>
  )
}

function Closed({ title, tone, deals, money }: {
  title: string
  tone: 'success' | 'danger'
  deals: DealCard[]
  money: (value: number | null) => string
}) {
  const total = deals.reduce((sum, deal) => sum + (deal.valueGbp ?? 0), 0)
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3 border-b border-line-subtle px-6 py-4">
        <h2 className="flex items-center gap-2 text-small font-bold text-content-primary">
          {title}
          <Chip tone={tone}>{deals.length}</Chip>
        </h2>
        <p className="text-small font-bold tabular-nums text-content-primary">{money(total)}</p>
      </div>
      {deals.length === 0 ? (
        <p className="px-6 py-5 text-small text-content-secondary">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {deals.slice(0, 6).map((deal) => (
            <li key={deal.id} className="flex items-center justify-between gap-3 px-6 py-3">
              <span className="min-w-0">
                <span className="block truncate text-small text-content-primary">{deal.title}</span>
                <span className="block truncate text-caption text-content-secondary">
                  {deal.customerName ?? 'No customer'}
                </span>
              </span>
              <span className="shrink-0 text-small font-bold tabular-nums text-content-primary">
                {money(deal.valueGbp)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/**
 * Why it was lost.
 *
 * The only stage that asks a question before accepting the move. A pipeline
 * full of losses with no reasons cannot tell you anything next quarter, which
 * is the one thing lost deals are good for.
 */
function LostDialog({ deal, onClose, onConfirm }: {
  deal: DealCard | null
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')

  return (
    <Modal
      open={deal !== null}
      onClose={onClose}
      title="Close this deal as lost"
      description={deal ? `${deal.title}${deal.customerName ? ` · ${deal.customerName}` : ''}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={reason.trim().length === 0}
            onClick={() => { onConfirm(reason.trim()); setReason('') }}
          >
            Mark as lost
          </Button>
        </>
      }
    >
      <TextField
        label="What happened"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Bought elsewhere, budget went, went quiet…"
        hint="A pipeline full of losses with no reasons cannot tell you anything next quarter."
        autoFocus
      />
    </Modal>
  )
}

/** The header action, kept here so the board and the button share one import. */
export function NewDealButton() {
  const query = useListQuery()
  return (
    <Button icon={<Plus className="h-4 w-4" />} onClick={() => query.set('new', '1')}>
      New deal
    </Button>
  )
}
