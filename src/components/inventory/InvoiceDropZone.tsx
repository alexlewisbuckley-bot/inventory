'use client'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, FileText, Loader2, Sparkles, Upload } from 'lucide-react'
import { Button, Card, CardBody, CardHeader, Chip, useToast } from '@/components/ui'
import { bookInInvoiceAction, type InvoiceActionState } from '@/app/actions/invoices'
import { EXTRACTION_METHOD_LABELS, VAT_SCHEME_LABELS, type ExtractionMethod, type VatScheme } from '@/lib/enums'
import { cn } from '@/lib/cn'

/**
 * Drop an invoice, get stock.
 *
 * The whole surface is one target, because the gesture people already have is
 * dragging a PDF out of an email onto a window — not finding a file input.
 * The window is the target rather than a rectangle inside it, so the drop
 * lands wherever it is let go.
 *
 * There is no confirm step. What replaces it is telling the truth afterwards,
 * in detail: every watch created is listed and linked, the supplier says
 * whether it was matched or newly created, and anything unreadable is named
 * rather than quietly dropped.
 */
export function InvoiceDropZone({ aiEnabled }: { aiEnabled: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [pending, start] = useTransition()
  const [state, setState] = useState<InvoiceActionState>({ ok: false })
  const [fileName, setFileName] = useState<string | null>(null)

  const submit = useCallback((file: File) => {
    setFileName(file.name)
    setState({ ok: false })
    const data = new FormData()
    data.set('invoice', file)
    start(async () => {
      const next = await bookInInvoiceAction({ ok: false }, data)
      setState(next)
      if (next.ok) {
        toast.success(next.message ?? 'Booked in')
        router.refresh()
      } else {
        toast.error('Could not book that invoice in', next.message)
      }
    })
  }, [router, toast])

  // Bound to the window, not to the card: a file dropped anywhere on this page
  // was meant for the only thing on it.
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      setDragging(true)
    }
    const leave = (event: DragEvent) => {
      if (event.relatedTarget) return
      setDragging(false)
    }
    const drop = (event: DragEvent) => {
      event.preventDefault()
      setDragging(false)
      const file = event.dataTransfer?.files?.[0]
      if (file) submit(file)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [submit])

  const result = state.result

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardBody>
          <div
            onClick={() => !pending && input.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                input.current?.click()
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Choose an invoice to book in"
            aria-busy={pending}
            className={cn(
              'flex min-h-[280px] cursor-pointer flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed px-6 py-10 text-center transition-colors',
              dragging
                ? 'border-teal-500 bg-teal-100/50'
                : 'border-line-strong hover:border-teal-500 hover:bg-surface-subtle',
              pending && 'pointer-events-none opacity-70',
            )}
          >
            {pending ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-content-accent" aria-hidden />
                <p className="text-body font-bold text-content-primary">Reading {fileName}…</p>
                <p className="max-w-md text-small text-content-secondary">
                  Finding the supplier, the watches and the VAT treatment. This takes a few seconds.
                </p>
              </>
            ) : (
              <>
                <Upload className="h-8 w-8 text-content-secondary" aria-hidden />
                <p className="text-h3 font-bold text-content-primary">Drop a supplier invoice anywhere</p>
                <p className="max-w-md text-small text-content-secondary">
                  PDF, a photo or a scan. Every watch on it is booked into stock with its
                  reference, serial, cost and VAT scheme — and the supplier is matched to your
                  book, or added to it.
                </p>
                <Button type="button" variant="secondary" className="mt-2">Choose a file</Button>
              </>
            )}
          </div>

          <input
            ref={input}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,application/pdf,image/*,text/plain,text/csv"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) submit(file)
              event.target.value = ''
            }}
          />

          <p className="mt-4 flex items-center justify-center gap-1.5 text-caption text-content-secondary">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {aiEnabled
              ? 'Read by Claude, cross-checked against the document text.'
              : 'Read by pattern matching. Set ANTHROPIC_API_KEY to have Claude read unfamiliar layouts and scans.'}
          </p>
        </CardBody>
      </Card>

      {state.message && !state.ok && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-state-danger/30 bg-state-danger/8 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-state-danger" aria-hidden />
          <p className="text-small text-state-danger">{state.message}</p>
        </div>
      )}

      {result && (
        <Card>
          <CardHeader
            title={`${result.created.length} booked in`}
            description={
              result.invoiceNo
                ? `Invoice ${result.invoiceNo} · ${result.supplierName}`
                : result.supplierName
            }
          />
          <CardBody className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={result.supplierCreated ? 'warning' : 'good'} dot>
                {result.supplierCreated ? 'New supplier created' : `Supplier matched (${matchLabel(result.matchKind)})`}
              </Chip>
              <Chip tone="neutral">{VAT_SCHEME_LABELS[result.vatScheme as VatScheme]}</Chip>
              <Chip tone="neutral">{result.currency}</Chip>
              <Chip tone="neutral">{EXTRACTION_METHOD_LABELS[result.extractedBy as ExtractionMethod]}</Chip>
            </div>

            {result.created.length > 0 && (
              <ul className="flex flex-col divide-y divide-line-subtle">
                {result.created.map((watch) => (
                  <li key={watch.id} className="flex items-center gap-3 py-2.5">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-state-good" aria-hidden />
                    <Link
                      href={`/inventory/${watch.id}`}
                      className="text-small font-bold text-content-primary hover:underline"
                    >
                      {watch.label || 'Stock item'}
                    </Link>
                    <span className="ml-auto text-caption tabular-nums text-content-secondary">
                      Stock {watch.stockNo}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {result.issues.length > 0 && (
              <div className="rounded-md border border-state-warning/30 bg-state-warning/8 p-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-small font-bold text-content-primary">
                  <AlertCircle className="h-4 w-4 text-state-warning" aria-hidden />
                  {result.issues.length} line{result.issues.length === 1 ? '' : 's'} not booked in
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {result.issues.map((issue, index) => (
                    <li key={index} className="text-caption text-content-secondary">
                      <span className="font-semibold text-content-primary">{issue.line}</span> — {issue.reason}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-caption text-content-secondary">
                  Add these by hand from{' '}
                  <Link href="/inventory/new" className="font-bold text-content-accent hover:underline">Add item</Link>.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5">
              <Link
                href="/inventory"
                className="text-small font-bold text-content-accent hover:underline"
              >
                Open the inventory →
              </Link>
              <span className="flex items-center gap-1.5 text-caption text-content-secondary">
                <FileText className="h-3.5 w-3.5" aria-hidden />
                The invoice is stored against every watch it bought.
              </span>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

function matchLabel(kind: string): string {
  switch (kind) {
    case 'VAT_NO': return 'VAT number'
    case 'REGISTRATION': return 'company number'
    case 'EMAIL': return 'email domain'
    case 'FUZZY': return 'name'
    default: return 'name'
  }
}
