'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'
import { Button, Modal, SelectField, TextField, useToast } from '@/components/ui'
import { moveDealAction } from '@/app/actions/crm'
import {
  DEAL_STAGE_LABELS, OPEN_DEAL_STAGES, type DealStage,
} from '@/lib/enums'

/**
 * The two commitments and the dropdown, at the top of the record.
 *
 * Won and Lost sit apart from the stage selector on purpose: they are terminal
 * and the others are not. Putting all eleven in one list makes "Lost" a
 * neighbour of "Negotiation" in a menu people operate quickly, which is how a
 * live deal gets closed by a mis-click.
 *
 * Won is deliberately *not* the sale. A deal that is won still needs the sale
 * recording against the watch, with an invoice number and a payment status —
 * so winning generates the tasks that say so rather than pretending the money
 * has arrived.
 */
export function DealHeader({ id, title, stage, canEdit }: {
  id: string
  title: string
  stage: DealStage
  canEdit: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()
  const [current, setCurrent] = useState<DealStage>(stage)
  const [losing, setLosing] = useState(false)
  const [reason, setReason] = useState('')

  if (!canEdit) return null

  const move = (next: DealStage, lostReason?: string) => {
    if (next === current) return
    if (next === 'LOST' && !lostReason) { setLosing(true); return }

    const previous = current
    setCurrent(next)
    start(async () => {
      const result = await moveDealAction(id, next, { lostReason })
      if (!result.ok) {
        setCurrent(previous)
        toast.error('Could not move the deal', result.message)
        return
      }
      toast.success(
        next === 'WON' ? 'Won. The follow-up tasks have been created.'
          : next === 'LOST' ? 'Closed as lost.'
          : `Moved to ${DEAL_STAGE_LABELS[next].toLowerCase()}.`,
      )
      router.refresh()
    })
  }

  const closed = current === 'WON' || current === 'LOST'

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SelectField
          name="stage"
          label="Stage"
          className="min-w-[180px]"
          value={closed ? '' : current}
          disabled={pending}
          // A closed deal shows where it ended as the placeholder rather than
          // as a selected option: reopening it is a decision, and a dropdown
          // that already has "Won" highlighted invites it by accident.
          placeholder={closed ? DEAL_STAGE_LABELS[current] : undefined}
          onChange={(event) => move(event.target.value as DealStage)}
          options={OPEN_DEAL_STAGES.map((value) => ({
            value, label: DEAL_STAGE_LABELS[value],
          }))}
        />

        <Button
          variant={current === 'WON' ? 'primary' : 'secondary'}
          icon={<Check className="h-4 w-4" />}
          disabled={pending || current === 'WON'}
          onClick={() => move('WON')}
        >
          Won
        </Button>
        <Button
          variant="ghost"
          icon={<X className="h-4 w-4" />}
          disabled={pending || current === 'LOST'}
          onClick={() => move('LOST')}
        >
          Lost
        </Button>
      </div>

      <Modal
        open={losing}
        onClose={() => setLosing(false)}
        title="Close this deal as lost"
        description={title}
        footer={
          <>
            <Button variant="ghost" onClick={() => setLosing(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={reason.trim().length === 0}
              onClick={() => {
                const text = reason.trim()
                setLosing(false)
                setReason('')
                move('LOST', text)
              }}
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
    </>
  )
}
