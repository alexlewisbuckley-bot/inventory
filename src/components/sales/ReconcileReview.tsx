'use client'
import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, Download, FileSpreadsheet, Link2, Unlink, Upload } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  Button, Card, Chip, EmptyState, Table, THead, TBody, TR, TD, TH, useToast,
} from '@/components/ui'
import { FIELD_LABELS, EXCEPTION_LABELS, type XeroField } from '@/lib/xero-diff'
import {
  stageXeroImportAction, applyXeroImportAction, unlinkSaleAction, linkSaleAction,
  setRateAction, setBucketAction, approveAliasAction,
} from '@/app/actions/xero'

/**
 * The review screen.
 *
 * Alex: "The review screen shows a diff per sale: current value → Xero
 * value, grouped by field. The user can accept all, accept per sale, or
 * reject individual changes. Nothing writes until approved."
 *
 * So the unit on screen is the invoice, with the watches it covers grouped
 * underneath it — which is the thing the old ledger could not show at all,
 * and the reason "one Xero invoice covers two watches" read as two
 * unrelated lines.
 *
 * Every change starts ticked. That is a deliberate choice and the opposite
 * of the safe-looking one: the common case is a file of corrections that
 * are all right, and making somebody tick forty boxes to agree with Xero is
 * how a reconciliation screen stops being used. Nothing is written until
 * Apply, every box can be cleared, and the ones worth a second look carry a
 * warning beside them.
 */

export interface ReviewSaleView {
  saleId: string
  stockNo: number | null
  tier: string
  allocated: number
  changes: Array<{ field: XeroField; fromText: string; toText: string }>
  exceptions: Array<{ kind: string; detail: string }>
}

export interface ReviewInvoiceView {
  id: string
  invoiceNo: string
  contactName: string
  invoiceDate: string | null
  currency: string
  total: number
  totalBase: number
  fxRate: number | null
  status: string
  reference: string
  bucket: string
  lines: Array<{ description: string; amount: number | null }>
  sales: ReviewSaleView[]
  proposedAlias: { systemName: string; xeroName: string } | null
  looksLikeBuyBack: boolean
}

export interface ReviewView {
  importId: string
  fileName: string
  appliedAt: string | null
  skippedRows: number
  invoices: ReviewInvoiceView[]
  unmatchedSales: Array<{
    saleId: string; stockNo: number | null; invoiceNo: string | null
    customerName: string | null; saleDate: string
  }>
  exceptions: Array<{ kind: string; invoiceNo: string | null; stockNo: number | null; detail: string }>
  changeCount: number
}

const TIER_WORDS: Record<string, string> = {
  invoice: 'invoice number',
  stock: 'stock number',
  fuzzy: 'customer, amount and date',
  manual: 'linked by hand',
}

const IMAGE = /\.(png|jpe?g|webp|gif)$/i

const money = (minor: number, currency: string) =>
  `${currency} ${(minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Every change on the screen, as the key the form posts it under. */
const keyFor = (saleId: string, field: string) => `approve:${saleId}:${field}`

export function ReconcileReview({ review, canApply }: {
  review: ReviewView | null
  canApply: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)

  /** Which changes are ticked. Absent means ticked — everything starts on. */
  const [off, setOff] = useState<Set<string>>(new Set())
  const isOn = (saleId: string, field: string) => !off.has(keyFor(saleId, field))
  const toggle = (saleId: string, field: string) => {
    const key = keyFor(saleId, field)
    setOff((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const allKeys = useMemo(
    () => (review?.invoices ?? [])
      .filter((invoice) => invoice.bucket === 'SALE')
      .flatMap((invoice) => invoice.sales.flatMap(
        (sale) => sale.changes.map((change) => keyFor(sale.saleId, change.field)))),
    [review],
  )
  const onCount = allKeys.filter((key) => !off.has(key)).length

  /**
   * A drop, whatever it was.
   *
   * Several files, because a screen of invoices is usually two or three
   * pictures and making somebody drop them one at a time would create
   * three imports where they meant one.
   */
  const upload = (files: File[]) => {
    if (files.length === 0) return
    const data = new FormData()
    for (const file of files) data.append('file', file)
    const pictures = files.every((file) => IMAGE.test(file.name) || file.type.startsWith('image/'))
    start(async () => {
      const result = await stageXeroImportAction(data)
      if (!result.ok) {
        toast.error(pictures ? 'Those screenshots could not be read' : 'That file could not be read', result.message)
        return
      }
      toast.success(
        `${result.invoiceCount} ${result.invoiceCount === 1 ? 'invoice' : 'invoices'} read`,
        [
          `${result.matchedCount} matched to sales`,
          result.skippedRows
            ? result.fromScreenshots
              ? `${result.skippedRows} could not be made out`
              : `${result.skippedRows} rows skipped`
            : null,
          // Worth saying out loud: a reading off a picture is a reading,
          // and the figures below are worth a second look before they are
          // approved.
          result.fromScreenshots ? 'read from the screenshots — check the figures' : null,
        ].filter(Boolean).join(' · '),
      )
      setOff(new Set())
      router.refresh()
    })
  }

  const apply = () => {
    if (!review) return
    const data = new FormData()
    data.set('importId', review.importId)
    for (const key of allKeys) if (!off.has(key)) data.set(key, 'on')
    start(async () => {
      const result = await applyXeroImportAction(data)
      if (!result.ok) {
        toast.error('Nothing was applied', result.message)
        return
      }
      toast.success(
        `${result.fieldsChanged} changes applied`,
        `across ${result.salesChanged} ${result.salesChanged === 1 ? 'sale' : 'sales'}`,
      )
      router.refresh()
    })
  }

  const run = (action: (data: FormData) => Promise<{ ok: boolean; message?: string }>, data: FormData, done: string) => {
    start(async () => {
      const result = await action(data)
      if (!result.ok) toast.error('That did not work', result.message)
      else { toast.success(done); router.refresh() }
    })
  }

  const exportExceptions = () => {
    if (!review) return
    const rows = [
      ['Kind', 'Invoice', 'Stock', 'Detail'],
      ...review.exceptions.map((row) => [
        EXCEPTION_LABELS[row.kind as keyof typeof EXCEPTION_LABELS] ?? row.kind,
        row.invoiceNo ?? '', row.stockNo === null ? '' : String(row.stockNo), row.detail,
      ]),
    ]
    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `xero-exceptions-${review.importId}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* ---------------- the drop ---------------- */}
      <Card>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            upload(Array.from(e.dataTransfer.files ?? []))
          }}
          className={cn(
            'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
            dragging ? 'border-content-accent bg-surface-subtle' : 'border-line-subtle',
          )}
        >
          <FileSpreadsheet className="h-7 w-7 text-content-secondary" aria-hidden />
          <div>
            <p className="text-small font-bold text-content-primary">
              Drop a Xero export or a screenshot here
            </p>
            <p className="mt-1 text-caption text-content-secondary">
              The Sales Invoices list as CSV or XLSX — or just a picture of the screen,
              several at once if it does not fit on one. Nothing is written until you approve it.
            </p>
          </div>
          <input
            ref={input}
            type="file"
            multiple
            accept=".csv,.xlsx,.xls,.tsv,image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            onChange={(e) => {
              upload(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
          <Button variant="secondary" onClick={() => input.current?.click()} disabled={pending}>
            <Upload className="h-4 w-4" aria-hidden /> {pending ? 'Reading…' : 'Choose files'}
          </Button>
        </div>
      </Card>

      {!review && (
        <Card>
          <EmptyState
            icon={<FileSpreadsheet className="h-6 w-6" />}
            title="Nothing imported yet"
            description="Drop the Sales Invoices export above, or a screenshot of the screen. Every invoice is matched to the sales it covers, and you see what would change before anything does."
          />
        </Card>
      )}

      {review && (
        <>
          {/* ---------------- what the file said ---------------- */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
              <div>
                <p className="text-small font-bold text-content-primary">{review.fileName}</p>
                <p className="mt-0.5 text-caption text-content-secondary">
                  {review.invoices.length} {review.invoices.length === 1 ? 'invoice' : 'invoices'}
                  {' · '}{review.changeCount} proposed {review.changeCount === 1 ? 'change' : 'changes'}
                  {review.skippedRows > 0 && ` · ${review.skippedRows} rows skipped`}
                  {review.appliedAt && ` · applied ${review.appliedAt}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {review.exceptions.length > 0 && (
                  <Button variant="secondary" onClick={exportExceptions}>
                    <Download className="h-4 w-4" aria-hidden /> Exceptions ({review.exceptions.length})
                  </Button>
                )}
                {canApply && !review.appliedAt && (
                  <Button onClick={apply} disabled={pending || onCount === 0}>
                    <Check className="h-4 w-4" aria-hidden />
                    Apply {onCount} {onCount === 1 ? 'change' : 'changes'}
                  </Button>
                )}
              </div>
            </div>
            {!review.appliedAt && allKeys.length > 0 && (
              <div className="flex items-center gap-3 border-t border-line-subtle px-6 py-3 text-caption">
                <button
                  type="button"
                  className="font-semibold text-content-accent hover:underline"
                  onClick={() => setOff(new Set())}
                >
                  Accept all
                </button>
                <button
                  type="button"
                  className="font-semibold text-content-secondary hover:underline"
                  onClick={() => setOff(new Set(allKeys))}
                >
                  Clear all
                </button>
                <span className="text-content-secondary">
                  {onCount} of {allKeys.length} ticked
                </span>
              </div>
            )}
          </Card>

          {/* ---------------- invoice by invoice ---------------- */}
          {review.invoices.map((invoice) => (
            <Card key={invoice.id} className="overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-subtle px-6 py-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-small font-bold text-content-primary">
                    {invoice.invoiceNo}
                    <Chip tone={invoice.status === 'PAID' ? 'good' : invoice.status === 'VOIDED' ? 'critical' : 'warning'}>
                      {invoice.status.replace(/_/g, ' ').toLowerCase()}
                    </Chip>
                    {invoice.bucket !== 'SALE' && <Chip tone="navy">{invoice.bucket.replace(/_/g, ' ').toLowerCase()}</Chip>}
                  </p>
                  <p className="mt-0.5 text-caption text-content-secondary">
                    {invoice.contactName || 'no contact'}
                    {invoice.invoiceDate && ` · ${invoice.invoiceDate}`}
                    {invoice.reference && ` · ${invoice.reference}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-small font-bold tabular-nums text-content-primary">
                    {money(invoice.total, invoice.currency)}
                  </p>
                  {invoice.currency !== 'AED' && (
                    <p className="mt-0.5 text-caption text-content-secondary tabular-nums">
                      {money(invoice.totalBase, 'AED')}
                    </p>
                  )}
                </div>
              </div>

              {/* The rate, editable per invoice, as asked. */}
              {invoice.currency !== 'AED' && !review.appliedAt && (
                <form
                  action={(data) => {
                    data.set('importId', review.importId)
                    data.set('invoiceId', invoice.id)
                    run(setRateAction, data, 'Rate saved')
                  }}
                  className="flex items-center gap-2 border-b border-line-subtle px-6 py-2.5 text-caption"
                >
                  <label htmlFor={`rate-${invoice.id}`} className="text-content-secondary">
                    Rate on the invoice date
                  </label>
                  <input
                    id={`rate-${invoice.id}`}
                    name="rate"
                    type="number"
                    step="0.0001"
                    defaultValue={invoice.fxRate ? (invoice.fxRate / 10_000).toFixed(4) : ''}
                    className="w-28 rounded-md border border-line-subtle bg-surface-raised px-2 py-1 tabular-nums"
                  />
                  <Button type="submit" variant="ghost" size="sm" disabled={pending}>Save</Button>
                </form>
              )}

              {invoice.sales.length === 0 ? (
                <div className="px-6 py-5">
                  <p className="text-caption text-content-secondary">
                    Nothing in the system matches this invoice.
                    {invoice.looksLikeBuyBack && ' It reads like a Buy Back.'}
                  </p>
                  {!review.appliedAt && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {(['SALE', 'BUYBACK', 'NOT_A_SALE'] as const).map((bucket) => (
                        <form
                          key={bucket}
                          action={(data) => {
                            data.set('importId', review.importId)
                            data.set('invoiceId', invoice.id)
                            data.set('bucket', bucket)
                            run(setBucketAction, data, 'Noted')
                          }}
                        >
                          <Button
                            type="submit"
                            size="sm"
                            variant={invoice.bucket === bucket ? 'primary' : 'secondary'}
                            disabled={pending}
                          >
                            {bucket === 'SALE' ? 'A sale' : bucket === 'BUYBACK' ? 'Buy Back' : 'Not a sale'}
                          </Button>
                        </form>
                      ))}
                      {review.unmatchedSales.length > 0 && (
                        <form
                          action={(data) => {
                            data.set('importId', review.importId)
                            data.set('invoiceId', invoice.id)
                            run(linkSaleAction, data, 'Linked')
                          }}
                          className="flex items-center gap-2"
                        >
                          <select
                            name="saleId"
                            defaultValue=""
                            className="rounded-md border border-line-subtle bg-surface-raised px-2 py-1 text-caption"
                          >
                            <option value="" disabled>Link a sale…</option>
                            {review.unmatchedSales.map((sale) => (
                              <option key={sale.saleId} value={sale.saleId}>
                                {sale.stockNo ? `Stock ${sale.stockNo}` : 'No stock no'}
                                {' · '}{sale.invoiceNo ?? 'no invoice'}
                                {sale.customerName ? ` · ${sale.customerName}` : ''}
                              </option>
                            ))}
                          </select>
                          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
                            <Link2 className="h-3.5 w-3.5" aria-hidden /> Link
                          </Button>
                        </form>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-line-subtle">
                  {invoice.sales.map((sale) => (
                    <div key={sale.saleId} className="px-6 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-small font-bold text-content-primary">
                          {sale.stockNo ? `Stock ${sale.stockNo}` : 'Sale'}
                          <span className="ml-2 font-normal text-caption text-content-secondary">
                            matched on {TIER_WORDS[sale.tier] ?? sale.tier}
                          </span>
                        </p>
                        <div className="flex items-center gap-3">
                          {invoice.sales.length > 1 && (
                            <span className="text-caption tabular-nums text-content-secondary">
                              share {money(sale.allocated, invoice.currency)}
                            </span>
                          )}
                          {!review.appliedAt && (
                            <form
                              action={(data) => {
                                data.set('importId', review.importId)
                                data.set('saleId', sale.saleId)
                                run(unlinkSaleAction, data, 'Unlinked')
                              }}
                            >
                              <Button type="submit" variant="ghost" size="sm" disabled={pending}>
                                <Unlink className="h-3.5 w-3.5" aria-hidden /> Unlink
                              </Button>
                            </form>
                          )}
                        </div>
                      </div>

                      {sale.exceptions.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {sale.exceptions.map((issue, i) => (
                            <li key={i} className="flex items-center gap-1.5 text-caption text-state-warning">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              {EXCEPTION_LABELS[issue.kind as keyof typeof EXCEPTION_LABELS] ?? issue.kind}: {issue.detail}
                            </li>
                          ))}
                        </ul>
                      )}

                      {sale.changes.length === 0 ? (
                        <p className="mt-2 text-caption text-content-secondary">
                          Already agrees with Xero.
                        </p>
                      ) : (
                        <ul className="mt-3 space-y-1.5">
                          {sale.changes.map((change) => (
                            <li key={change.field} className="flex items-center gap-2.5 text-caption">
                              <input
                                type="checkbox"
                                id={keyFor(sale.saleId, change.field)}
                                checked={isOn(sale.saleId, change.field)}
                                disabled={!!review.appliedAt || !canApply}
                                onChange={() => toggle(sale.saleId, change.field)}
                                className="h-3.5 w-3.5 shrink-0"
                              />
                              <label
                                htmlFor={keyFor(sale.saleId, change.field)}
                                className="flex flex-wrap items-center gap-1.5"
                              >
                                <span className="w-[112px] shrink-0 text-content-secondary">
                                  {FIELD_LABELS[change.field]}
                                </span>
                                <span className="text-content-muted line-through">{change.fromText}</span>
                                <span aria-hidden className="text-content-muted">→</span>
                                <span className="font-semibold text-content-primary">{change.toText}</span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {invoice.proposedAlias && !review.appliedAt && (
                <form
                  action={(data) => {
                    data.set('systemName', invoice.proposedAlias!.systemName)
                    data.set('xeroName', invoice.proposedAlias!.xeroName)
                    run(approveAliasAction, data, 'Alias remembered')
                  }}
                  className="flex flex-wrap items-center gap-2 border-t border-line-subtle bg-surface-subtle px-6 py-2.5 text-caption"
                >
                  <span className="text-content-secondary">
                    Remember “{invoice.proposedAlias.systemName}” is “{invoice.proposedAlias.xeroName}”?
                  </span>
                  <Button type="submit" variant="ghost" size="sm" disabled={pending}>Remember it</Button>
                </form>
              )}
            </Card>
          ))}

          {/* ---------------- sales Xero said nothing about ---------------- */}
          {review.unmatchedSales.length > 0 && (
            <Card className="overflow-hidden">
              <div className="border-b border-line-subtle px-6 py-4">
                <h2 className="text-small font-bold text-content-primary">
                  Sales with no invoice in this file
                </h2>
                <p className="mt-0.5 text-caption text-content-secondary">
                  Booked here, inside the dates this export covers, and not in it.
                </p>
              </div>
              <Table layout="fixed" minWidth="560px">
                <THead>
                  <TR>
                    <TH width="90px">Stock</TH>
                    <TH width="150px">Invoice here</TH>
                    <TH width="180px">Customer</TH>
                    <TH width="110px">Sold</TH>
                  </TR>
                </THead>
                <TBody>
                  {review.unmatchedSales.map((sale) => (
                    <TR key={sale.saleId}>
                      <TD className="tabular-nums">{sale.stockNo ?? '—'}</TD>
                      <TD>{sale.invoiceNo ?? '—'}</TD>
                      <TD className="truncate">{sale.customerName ?? '—'}</TD>
                      <TD className="tabular-nums text-content-secondary">{sale.saleDate}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
