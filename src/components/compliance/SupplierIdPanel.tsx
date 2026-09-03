'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileCheck2, Trash2, Upload } from 'lucide-react'
import {
  Button, Modal, TextField, SelectField, TextareaField, RadioCard, useToast,
} from '@/components/ui'
import { CheckLight } from './CheckLight'
import { recordIdCheckAction } from '@/app/actions/compliance'
import { ID_VALIDITY_MONTHS, idCheckState, idRecheckDueAt, type IdCheckFacts } from '@/lib/checks'
import {
  ID_DOCUMENT_KINDS, ID_DOCUMENT_KIND_LABELS, type IdDocumentKind,
} from '@/lib/enums'
import { formatDate } from '@/lib/dates'

/** One identity document as the supplier record lists it — never its bytes. */
export interface IdDocument {
  id: string
  kind: IdDocumentKind
  holderName: string | null
  expiresOn: string | null
  fileName: string
  byteSize: number
  uploadedByName: string | null
}

export interface SupplierIdPanelProps {
  supplierId: string
  supplierName: string
  director: { name: string | null; role: string | null; dob: string | null }
  facts: IdCheckFacts
  checkedByName: string | null
  notes: string | null
  documents: IdDocument[]
  canManage: boolean
}

/**
 * Who signs for this supplier, and the evidence for it.
 *
 * On the supplier record rather than anywhere else because that is where the
 * question is asked: not "which of my four hundred watches has a problem" —
 * the stock list answers that — but "have we identified these people, and can
 * I produce the document if somebody asks".
 */
export function SupplierIdPanel({
  supplierId, supplierName, director, facts, checkedByName, notes, documents, canManage,
}: SupplierIdPanelProps) {
  const state = idCheckState(facts)
  const dueAt = idRecheckDueAt(facts.idCheckedAt)
  const [recording, setRecording] = useState(false)

  return (
    // A section with a name rather than a div: it is a distinct part of the
    // record with a heading, and giving it one makes it addressable by screen
    // readers and by anything else that navigates by landmark.
    <section aria-label="Director and identification" className="mt-6 border-t border-line-subtle pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h4 className="text-caption font-semibold text-content-secondary">Director &amp; identification</h4>
          <CheckLight state={state} />
        </div>
        {canManage && (
          <Button size="sm" variant="secondary" onClick={() => setRecording(true)}>
            <FileCheck2 className="h-4 w-4" aria-hidden />
            Record ID check
          </Button>
        )}
      </div>

      <p className="mt-2 text-small text-content-primary">{state.detail}</p>

      <dl className="mt-2 flex flex-col gap-1">
        <Fact label="Director" value={director.name} />
        <Fact label="Position" value={director.role} />
        <Fact label="Date of birth" value={director.dob ? formatDate(director.dob) : null} />
        {facts.idCheckedAt && (
          <Fact
            label="Identified"
            value={`${formatDate(facts.idCheckedAt)}${checkedByName ? ` by ${checkedByName}` : ''}`}
          />
        )}
        {dueAt && state.tone === 'GREEN' && <Fact label="Due again" value={formatDate(dueAt)} />}
      </dl>

      {notes && (
        <p className="mt-2 whitespace-pre-line text-caption text-content-secondary">{notes}</p>
      )}

      <Documents
        supplierId={supplierId}
        documents={documents}
        defaultHolder={director.name}
        canManage={canManage}
      />

      <RecordIdCheckModal
        open={recording}
        onClose={() => setRecording(false)}
        supplierId={supplierId}
        supplierName={supplierName}
        directorName={director.name}
        documents={documents}
      />
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-caption text-content-secondary">{label}</dt>
      <dd className={value ? 'min-w-0 truncate text-right text-small text-content-primary' : 'text-small text-content-secondary'}>
        {value ?? 'Not recorded'}
      </dd>
    </div>
  )
}

const sizeOf = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`

/** The documents on file, with the control that adds one. */
function Documents({ supplierId, documents, defaultHolder, canManage }: {
  supplierId: string
  documents: IdDocument[]
  defaultHolder: string | null
  canManage: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<IdDocumentKind>('PASSPORT')
  const [expiresOn, setExpiresOn] = useState('')

  const upload = async (file: File) => {
    setBusy(true)
    const body = new FormData()
    body.set('file', file)
    body.set('supplierId', supplierId)
    body.set('kind', kind)
    body.set('expiresOn', expiresOn)
    if (defaultHolder) body.set('holderName', defaultHolder)

    const response = await fetch('/api/supplier-documents', { method: 'POST', body })
    setBusy(false)
    if (input.current) input.current.value = ''

    if (!response.ok) {
      const { error } = await response.json().catch(() => ({ error: undefined }))
      toast.error('Could not attach that document', error)
      return
    }
    setExpiresOn('')
    toast.success('Document attached')
    router.refresh()
  }

  const remove = async (id: string) => {
    setBusy(true)
    const response = await fetch(`/api/supplier-documents?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    setBusy(false)
    if (!response.ok) {
      toast.error('Could not remove that document')
      return
    }
    toast.success('Document removed')
    router.refresh()
  }

  return (
    <div className="mt-3">
      {documents.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1.5">
          {documents.map((document) => {
            const expired = document.expiresOn ? new Date(document.expiresOn) < new Date() : false
            return (
              <li key={document.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                {/* Only supplier:manage can open one, so the link is not
                    offered to anybody who would only get a 403 from it. */}
                {canManage ? (
                  <a
                    href={`/api/supplier-documents/${document.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 truncate text-small font-bold text-content-accent hover:underline"
                  >
                    {ID_DOCUMENT_KIND_LABELS[document.kind]}
                    {document.holderName ? ` · ${document.holderName}` : ''}
                  </a>
                ) : (
                  <span className="min-w-0 truncate text-small text-content-primary">
                    {ID_DOCUMENT_KIND_LABELS[document.kind]}
                  </span>
                )}
                <span className="flex items-center gap-2 text-caption text-content-secondary">
                  <span className={expired ? 'font-bold text-state-critical' : undefined}>
                    {document.expiresOn ? `${expired ? 'expired' : 'expires'} ${formatDate(document.expiresOn)}` : 'no expiry'}
                  </span>
                  <span>· {sizeOf(document.byteSize)}</span>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => remove(document.id)}
                      disabled={busy}
                      aria-label={`Remove ${document.fileName}`}
                      className="rounded-sm p-1 text-content-secondary hover:bg-state-critical/10 hover:text-state-critical"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {canManage && (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <SelectField
            name="kind"
            label="Document"
            value={kind}
            onChange={(event) => setKind(event.target.value as IdDocumentKind)}
            options={ID_DOCUMENT_KINDS.map((k) => ({ value: k, label: ID_DOCUMENT_KIND_LABELS[k] }))}
          />
          <TextField
            name="expiresOn"
            type="date"
            label="Expires"
            value={expiresOn}
            onChange={(event) => setExpiresOn(event.target.value)}
            hint="As printed on the document."
          />
          <div>
            <input
              ref={input}
              type="file"
              accept="application/pdf,image/*"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void upload(file)
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={() => input.current?.click()}
            >
              <Upload className="h-4 w-4" aria-hidden />
              Attach
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Writing down that somebody looked.
 *
 * Verifying makes you name the document it was made against. A green light
 * with no evidence behind it is the false green the whole feature exists to
 * prevent, and it is also the one a person would produce under pressure to
 * clear a list.
 */
function RecordIdCheckModal({ open, onClose, supplierId, supplierName, directorName, documents }: {
  open: boolean
  onClose: () => void
  supplierId: string
  supplierName: string
  directorName: string | null
  documents: IdDocument[]
}) {
  const toast = useToast()
  const [status, setStatus] = useState<'VERIFIED' | 'REJECTED'>('VERIFIED')
  const [chosen, setChosen] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  /**
   * Derived rather than initialised, because the list arrives after the state
   * would have been set.
   *
   * The panel stays mounted while a document is uploaded — the list refreshes
   * underneath it — so `useState(documents[0]?.id)` captured the empty list and
   * kept it. The select then showed the first document while holding nothing,
   * and pressing Record submitted a check against no document at all.
   */
  const documentId = chosen && documents.some((document) => document.id === chosen)
    ? chosen
    : documents[0]?.id ?? ''
  const setDocumentId = setChosen

  const submit = async () => {
    setBusy(true)
    const result = await recordIdCheckAction(
      supplierId,
      status,
      status === 'VERIFIED' ? documentId || null : null,
      notes || null,
    )
    setBusy(false)
    if (result.ok) {
      toast.success(result.message ?? 'Recorded')
      setNotes('')
      onClose()
    } else {
      toast.error('Could not record that check', result.message)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Identify the director of ${supplierName}`}
      description={directorName
        ? `Confirming you have seen identification for ${directorName}.`
        : 'Add the director to the supplier record first — there is nobody to identify.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!directorName}>Record it</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div role="radiogroup" aria-label="Outcome" className="flex flex-col gap-2">
          <RadioCard
            checked={status === 'VERIFIED'}
            onSelect={() => setStatus('VERIFIED')}
            title="Identified"
            description={`Good for ${ID_VALIDITY_MONTHS} months from today.`}
          />
          <RadioCard
            checked={status === 'REJECTED'}
            onSelect={() => setStatus('REJECTED')}
            title="Not accepted"
            description="The document did not stand up. The supplier shows red until it is resolved."
          />
        </div>

        {status === 'VERIFIED' && (
          documents.length > 0 ? (
            <SelectField
              name="documentId"
              label="Identified from"
              value={documentId}
              onChange={(event) => setDocumentId(event.target.value)}
              hint="Recorded against the check, so a document that lapses later turns this red rather than waiting out the six months."
              options={documents.map((document) => ({
                value: document.id,
                label: `${ID_DOCUMENT_KIND_LABELS[document.kind]}${document.expiresOn ? ` · expires ${document.expiresOn}` : ''}`,
              }))}
            />
          ) : (
            <p className="rounded-md border border-state-warning/40 bg-state-warning/8 p-3 text-caption text-content-primary">
              Attach the identity document first. Recording a check with no evidence behind it is
              the one thing this is meant to make impossible.
            </p>
          )
        )}

        <TextareaField
          name="notes"
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="How the document was seen — in person, certified copy, video call."
        />
      </div>
    </Modal>
  )
}
