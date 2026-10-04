'use client'
import { useRef, useState } from 'react'
import { FileText, Loader2, Paperclip, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, useToast } from '@/components/ui'
import { ID_DOCUMENT_KIND_LABELS, type IdDocumentKind } from '@/lib/enums'

export interface HeldDocument {
  id: string
  kind: string
  fileName: string
  byteSize: number
  expiresOn: string | null
  uploadedByName: string | null
}

/** A photograph of a passport page is a couple of megabytes; eight is generous. */
const MAX_BYTES = 8 * 1024 * 1024
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif'

function size(bytes: number): string {
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Attach a held file once the customer it belongs to exists.
 *
 * The create case cannot upload while it is being typed — there is no record
 * to hang the bytes off — so the file waits and the caller sends it the moment
 * the save comes back with an id. Exported rather than duplicated because both
 * forms that take identification have the same two-stage problem.
 */
export async function uploadIdDocument(
  file: File, customerId: string, kind: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const body = new FormData()
  body.set('file', file)
  body.set('customerId', customerId)
  body.set('kind', kind || 'PASSPORT')
  try {
    const response = await fetch('/api/supplier-documents', { method: 'POST', body })
    const payload = await response.json()
    if (!response.ok) return { ok: false, error: payload.error ?? 'Could not attach that' }
    return { ok: true, id: payload.id }
  } catch {
    return { ok: false, error: 'Could not attach that' }
  }
}

/**
 * The document itself, not just its number.
 *
 * A passport number typed into a box is what somebody read out; the page is
 * the evidence. It goes in the same table a supplier's director's passport
 * already uses, is served by the same audited route, and is opened by the
 * same deliberate click — never rendered inline, because a scan of somebody's
 * passport should not be sitting on screen behind whatever is being discussed.
 *
 * Two modes, because of when the record exists. Against a customer already on
 * the book it uploads immediately. Against one being created in the same
 * gesture — a buyer typed into a sale — there is nothing to attach it to yet,
 * so the file is held and the caller uploads it once the record has an id.
 */
export function IdDocumentUpload({
  customerId, kind, held = [], onStage, staged, disabled,
}: {
  /** Null while the customer is still being created. */
  customerId: string | null
  kind: IdDocumentKind | string
  held?: HeldDocument[]
  /** Called with the file when there is nothing to attach it to yet. */
  onStage?: (file: File | null) => void
  staged?: File | null
  disabled?: boolean
}) {
  const toast = useToast()
  const input = useRef<HTMLInputElement | null>(null)
  const [documents, setDocuments] = useState<HeldDocument[]>(held)
  const [busy, setBusy] = useState(false)

  const take = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_BYTES) {
      toast.error('That file is over 8 MB', 'A photograph of the page is enough — it does not need to be a full scan.')
      return
    }
    if (!customerId) { onStage?.(file); return }

    setBusy(true)
    const result = await uploadIdDocument(file, customerId, String(kind || 'PASSPORT'))
    setBusy(false)
    if (!result.ok) { toast.error('Could not attach that', result.error); return }
    setDocuments((current) => [{
      id: result.id,
      kind: String(kind || 'PASSPORT'),
      fileName: file.name,
      byteSize: file.size,
      expiresOn: null,
      uploadedByName: null,
    }, ...current])
    toast.success('Document attached')
  }

  const remove = async (id: string) => {
    setBusy(true)
    const response = await fetch(`/api/supplier-documents?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    setBusy(false)
    if (!response.ok) { toast.error('Could not remove that'); return }
    setDocuments((current) => current.filter((d) => d.id !== id))
  }

  return (
    <div className="sm:col-span-2">
      <p className="text-caption font-semibold text-content-secondary">The document itself</p>

      <ul className="mt-1.5 flex flex-col gap-1.5">
        {documents.map((document) => (
          <li
            key={document.id}
            className="flex items-center gap-2 rounded-sm border border-line-subtle bg-surface-raised px-3 py-2"
          >
            <FileText className="h-4 w-4 shrink-0 text-content-secondary" aria-hidden />
            <a
              href={`/api/supplier-documents/${document.id}`}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate text-small text-content-primary hover:underline"
            >
              {document.fileName}
            </a>
            <span className="shrink-0 text-caption tabular-nums text-content-muted">
              {ID_DOCUMENT_KIND_LABELS[document.kind as IdDocumentKind] ?? document.kind} · {size(document.byteSize)}
            </span>
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(document.id)}
                disabled={busy}
                aria-label={`Remove ${document.fileName}`}
                className="shrink-0 rounded-sm p-1 text-content-secondary hover:bg-surface-subtle hover:text-state-danger"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </li>
        ))}

        {/* Held, not yet uploaded: there is no record to attach it to until
            the one being created has been saved. */}
        {staged && (
          <li className="flex items-center gap-2 rounded-sm border border-dashed border-line-strong bg-surface-subtle px-3 py-2">
            <Paperclip className="h-4 w-4 shrink-0 text-content-secondary" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-small text-content-primary">{staged.name}</span>
            <span className="shrink-0 text-caption text-content-muted">
              attaches when this is saved
            </span>
            <button
              type="button"
              onClick={() => onStage?.(null)}
              aria-label={`Do not attach ${staged.name}`}
              className="shrink-0 rounded-sm p-1 text-content-secondary hover:bg-surface-subtle hover:text-state-danger"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        )}
      </ul>

      {!disabled && (
        <>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className={cn('mt-2', busy && 'pointer-events-none')}
            icon={busy
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Paperclip className="h-3.5 w-3.5" />}
            onClick={() => input.current?.click()}
          >
            {documents.length || staged ? 'Attach another' : 'Attach a photograph or scan'}
          </Button>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={(e) => { void take(e.target.files?.[0]); e.target.value = '' }}
          />
          <p className="mt-1.5 text-caption text-content-secondary">
            A photograph of the page is enough. Opened only by a deliberate click, and every opening is
            recorded.
          </p>
        </>
      )}
    </div>
  )
}
