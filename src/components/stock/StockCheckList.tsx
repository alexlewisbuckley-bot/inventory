'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ClipboardCheck } from 'lucide-react'
import {
  Button, Card, Chip, EmptyState, Modal, SelectField, Table, TBody, TD, TH, THead, TR,
  TextareaField, useToast,
} from '@/components/ui'
import { startStockCheckAction } from '@/app/actions/stock-checks'
import {
  STOCK_CHECK_STATUS_LABELS, STOCK_CHECK_STATUS_TONE, type StockCheckStatus,
} from '@/lib/enums'
import { formatDate } from '@/lib/dates'

export interface StockCheckRow {
  id: string
  reference: string
  status: StockCheckStatus
  locationName: string | null
  expectedCount: number
  foundCount: number | null
  missingCount: number | null
  elsewhereCount: number | null
  countedSoFar: number
  startedAt: string
  startedByName: string | null
}

/** Past and present counts, and the button that starts one. */
export function StockCheckList({ checks, locations, canCount }: {
  checks: StockCheckRow[]
  locations: Array<{ id: string; name: string }>
  canCount: boolean
}) {
  const [starting, setStarting] = useState(false)

  return (
    <>
      {canCount && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setStarting(true)}>
            <ClipboardCheck className="h-4 w-4" aria-hidden />
            Start a stock check
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        {checks.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck className="h-6 w-6" />}
            title="No stock has been counted yet"
            description="A stock check freezes a list of what you should be holding, then walks you through confirming each one is really there."
            action={canCount ? <Button onClick={() => setStarting(true)}>Start a stock check</Button> : undefined}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Check</TH>
                <TH width="150px">Started</TH>
                <TH width="140px">By</TH>
                <TH width="180px" align="right">Result</TH>
                <TH width="130px">Status</TH>
              </TR>
            </THead>
            <TBody>
              {checks.map((check) => (
                <TR key={check.id}>
                  <TD>
                    <Link href={`/stock-checks/${check.id}`} className="font-bold text-content-primary hover:underline">
                      {check.reference}
                    </Link>
                    <span className="block text-caption text-content-secondary">
                      {check.locationName ?? 'Everywhere'} · {check.expectedCount} expected
                    </span>
                  </TD>
                  <TD className="text-content-secondary">{formatDate(check.startedAt)}</TD>
                  <TD className="text-content-secondary">{check.startedByName ?? '—'}</TD>
                  <TD align="right">
                    {check.status === 'OPEN' ? (
                      <span className="text-content-secondary">
                        {check.countedSoFar} of {check.expectedCount} counted
                      </span>
                    ) : check.status === 'ABANDONED' ? (
                      <span className="text-content-secondary">—</span>
                    ) : (
                      <span className="flex flex-wrap justify-end gap-1">
                        <Chip tone="good">{check.foundCount ?? 0} found</Chip>
                        {(check.elsewhereCount ?? 0) > 0 && (
                          <Chip tone="warning">{check.elsewhereCount} elsewhere</Chip>
                        )}
                        {(check.missingCount ?? 0) > 0 && (
                          <Chip tone="critical">{check.missingCount} missing</Chip>
                        )}
                      </span>
                    )}
                  </TD>
                  <TD>
                    <Chip tone={STOCK_CHECK_STATUS_TONE[check.status]} dot={check.status === 'OPEN'}>
                      {STOCK_CHECK_STATUS_LABELS[check.status]}
                    </Chip>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <StartModal
        open={starting}
        onClose={() => setStarting(false)}
        locations={locations}
      />
    </>
  )
}

/**
 * Opening a count.
 *
 * Location first, because that is how counting is actually done — one safe or
 * one shop at a time, by somebody standing in it. Counting everywhere at once
 * is offered but is not the default: it produces a list nobody can finish in
 * one go, and a stock check left half done is worse than none.
 */
function StartModal({ open, onClose, locations }: {
  open: boolean
  onClose: () => void
  locations: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const toast = useToast()
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setBusy(true)
    const result = await startStockCheckAction(locationId || null, notes || null)
    setBusy(false)
    if (result.ok && result.id) {
      toast.success('Stock check opened')
      setNotes('')
      onClose()
      router.push(`/stock-checks/${result.id}`)
    } else {
      toast.error('Could not start it', result.message)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start a stock check"
      description="The list is frozen as it stands now, so anything sold while you count stays on it and the numbers still add up."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={start} loading={busy}>Start counting</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SelectField
          name="locationId"
          label="What to count"
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          hint="One place at a time is easier to finish, and a check nobody finishes is worth nothing."
          options={[
            ...locations.map((location) => ({ value: location.id, label: location.name })),
            { value: '', label: 'Everywhere — all stock held' },
          ]}
        />
        <TextareaField
          name="notes"
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Why this count is being taken, if it is worth saying."
        />
      </div>
    </Modal>
  )
}
