'use client'
import { useState } from 'react'
import { ExternalLink, ShieldCheck } from 'lucide-react'
import {
  Card, CardHeader, CardBody, Button, Modal, TextField, TextareaField, RadioCard, useToast,
} from '@/components/ui'
import { CheckLight } from './CheckLight'
import { recordRegisterCheckAction } from '@/app/actions/compliance'
import type { CheckState } from '@/lib/checks'
import { formatDate } from '@/lib/dates'

export interface WatchChecksCardProps {
  watchId: string
  serial: string | null
  vat: CheckState
  register: CheckState
  supplierName: string
  /** The name HMRC holds against the supplier's number, where it answered. */
  registeredName: string | null
  registerCheckedAt: string | null
  registerCheckedBy: string | null
  registerCheckRef: string | null
  registerCheckNotes: string | null
  registerUrl: string
  canRecord: boolean
}

/**
 * The two checks on one watch.
 *
 * Side by side rather than in the details list, because they are the two
 * questions somebody asks before they let a watch out of the building, and
 * burying them among twenty rows of specification is how they get skipped.
 */
export function WatchChecksCard({
  watchId, serial, vat, register, supplierName, registeredName,
  registerCheckedAt, registerCheckedBy, registerCheckRef, registerCheckNotes,
  registerUrl, canRecord,
}: WatchChecksCardProps) {
  const [recording, setRecording] = useState(false)

  return (
    <Card>
      <CardHeader
        title="Checks"
        description="Who you bought from, and whether the piece is reported stolen"
      />
      <CardBody>
        <div className="grid gap-5 sm:grid-cols-2">
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-caption font-semibold text-content-secondary">Supplier VAT</h3>
              <CheckLight state={vat} />
            </div>
            <p className="text-small text-content-primary">{vat.detail}</p>
            {registeredName && (
              <p className="mt-1.5 text-caption text-content-secondary">
                HMRC holds the number against {registeredName}.
              </p>
            )}
            <p className="mt-1.5 text-caption text-content-secondary">
              Checked against {supplierName} on the supplier record.
            </p>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-caption font-semibold text-content-secondary">The Watch Register</h3>
              <CheckLight state={register} />
            </div>
            <p className="text-small text-content-primary">{register.detail}</p>

            {registerCheckedAt && (
              <p className="mt-1.5 text-caption text-content-secondary">
                {formatDate(registerCheckedAt)}
                {registerCheckedBy && ` by ${registerCheckedBy}`}
                {registerCheckRef && ` · ref ${registerCheckRef}`}
              </p>
            )}
            {registerCheckNotes && (
              <p className="mt-1.5 whitespace-pre-line text-caption text-content-secondary">{registerCheckNotes}</p>
            )}

            {canRecord && serial && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a
                  href={registerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-caption font-bold text-content-accent hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  Search {serial}
                </a>
                <Button size="sm" variant="secondary" onClick={() => setRecording(true)}>
                  Record result
                </Button>
              </div>
            )}
          </section>
        </div>
      </CardBody>

      <RecordRegisterCheckModal
        open={recording}
        onClose={() => setRecording(false)}
        watchId={watchId}
        serial={serial}
      />
    </Card>
  )
}

/**
 * Writing down what the register said.
 *
 * Two outcomes, both explicit. There is no "not sure" — a search that did not
 * produce an answer has not been made, and recording it as anything would turn
 * an amber light green on the strength of nothing.
 */
function RecordRegisterCheckModal({ open, onClose, watchId, serial }: {
  open: boolean
  onClose: () => void
  watchId: string
  serial: string | null
}) {
  const toast = useToast()
  const [status, setStatus] = useState<'CLEAR' | 'RECORDED'>('CLEAR')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const result = await recordRegisterCheckAction(watchId, status, reference || null, notes || null)
    setBusy(false)
    if (result.ok) {
      toast.success(result.message ?? 'Recorded')
      setReference('')
      setNotes('')
      setStatus('CLEAR')
      onClose()
    } else {
      toast.error('Could not record that check', result.message)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record a Watch Register search"
      description={serial ? `What the register returned for serial ${serial}.` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy}>Record it</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div role="radiogroup" aria-label="Search outcome" className="flex flex-col gap-2">
          <RadioCard
            checked={status === 'CLEAR'}
            onSelect={() => setStatus('CLEAR')}
            title="Clear"
            description="Searched, nothing found against this serial."
          />
          <RadioCard
            checked={status === 'RECORDED'}
            onSelect={() => setStatus('RECORDED')}
            title="Found on the register"
            description="Reported lost or stolen. The item must not be sold."
          />
        </div>

        <TextField
          name="reference"
          label="Register reference"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          hint="The search or certificate reference, where one was issued. Optional."
        />
        <TextareaField
          name="notes"
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={status === 'RECORDED'
            ? 'What the register said, and who has been told.'
            : 'Anything worth remembering about the search.'}
        />

        {status === 'RECORDED' && (
          <p className="rounded-md border border-state-critical/40 bg-state-critical/8 p-3 text-caption text-content-primary">
            <ShieldCheck className="mr-1.5 inline h-3.5 w-3.5 text-state-critical" aria-hidden />
            This marks the item red on every screen it appears on. It does not remove it from stock or
            notify anybody — that is a decision for a person, not for this form.
          </p>
        )}
      </div>
    </Modal>
  )
}
