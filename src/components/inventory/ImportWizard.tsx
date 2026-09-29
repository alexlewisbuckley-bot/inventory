'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormState, useFormStatus } from 'react-dom'
import {
  AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileUp, Info, Upload, X,
} from 'lucide-react'
import {
  Card, CardHeader, CardBody, CardFooter, Button, LinkButton, Chip,
  Table, THead, TBody, TR, TD, TH, useToast, useCurrency,
} from '@/components/ui'
import { previewImportAction, commitImportAction, type ImportPreviewState } from '@/app/actions/watches'
import { toMinor } from '@/lib/money'
import { formatDate } from '@/lib/dates'
import { IMPORT_COLUMNS, headerFor, headersFor } from '@/lib/import-columns'
import { cn } from '@/lib/cn'

const INITIAL: ImportPreviewState = { ok: false }

/**
 * Bring a spreadsheet in.
 *
 * Three steps in order: take the template, give it back, see what will happen.
 * The template is the whole point — this screen used to open with an empty
 * paste box and a paragraph describing eight columns in prose, so the first
 * attempt failed validation roughly every time. Handing over a file with the
 * columns already named, an example row in the formats that actually parse,
 * and this installation's own location names makes the first attempt the
 * successful one.
 */
export function ImportWizard({ locationNames }: { locationNames: string[] }) {
  const router = useRouter()
  const toast = useToast()
  const { money, currency } = useCurrency()
  const [state, action] = useFormState(previewImportAction, INITIAL)
  const [committing, setCommitting] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [showPaste, setShowPaste] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const preview = state.preview
  // Something to do, not merely something to read. A file whose every row
  // matches stock exactly is a successful check with nothing to apply, and
  // offering an enabled Import button for it invites a pointless write.
  const pending = preview ? preview.createCount + preview.updateCount : 0
  const canCommit = preview && preview.errorCount === 0 && pending > 0

  const takeFiles = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (fileInput.current) {
      // Assigning a DataTransfer list is the only way to put a dropped file
      // into a form input so the server action actually receives it.
      const transfer = new DataTransfer()
      transfer.items.add(file)
      fileInput.current.files = transfer.files
    }
    setFileName(file.name)
  }

  const commit = async () => {
    if (!preview) return
    setCommitting(true)
    const result = await commitImportAction(preview.rows)
    setCommitting(false)
    if (result.ok) {
      toast.success('Import complete', result.message)
      router.push('/inventory')
    } else {
      toast.error('Import failed', result.message)
    }
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <Card>
        <CardHeader
          title="1 · Start from the template"
          description="The columns are already named, with an example row and your own location names."
        />
        <CardBody className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <LinkButton href="/api/import/template" variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />}>
              Download the template
            </LinkButton>
          </div>

          <details className="rounded-md border border-line-subtle">
            <summary className="cursor-pointer px-4 py-3 text-small font-bold text-content-primary">
              What goes in each column
            </summary>
            <div className="border-t border-line-subtle">
              <Table>
                <THead>
                  <TR>
                    <TH width="190px">Column</TH>
                    <TH width="110px">Needed?</TH>
                    <TH>What it wants</TH>
                    <TH width="150px">Example</TH>
                  </TR>
                </THead>
                <TBody>
                  {IMPORT_COLUMNS.map((column) => (
                    <TR key={column.key}>
                      <TD className="font-bold text-content-primary">{headerFor(column, currency)}</TD>
                      <TD>
                        <Chip tone={column.derived ? 'neutral' : column.required ? 'navy' : 'neutral'}>
                          {column.derived ? 'Read-only' : column.required ? 'Required' : 'Optional'}
                        </Chip>
                      </TD>
                      <TD className="text-content-secondary">{column.hint}</TD>
                      <TD className="text-content-secondary">{column.example}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </details>

          <div className="flex items-start gap-2.5 rounded-md bg-surface-subtle px-4 py-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-content-secondary" aria-hidden />
            <p className="text-caption text-content-secondary">
              Locations must already exist — yours are{' '}
              <strong className="text-content-primary">{locationNames.join(', ')}</strong>.
              Brands and suppliers are created for you when the name is new, so spelling matters.
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="2 · Send it back"
          description="Excel or CSV. Nothing is written until you have seen what will happen."
        />
        <form action={action}>
          <CardBody className="flex flex-col gap-4">
            <div
              onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); takeFiles(event.dataTransfer.files) }}
              className={cn(
                'rounded-md border-2 border-dashed px-6 py-8 text-center transition-colors',
                dragging ? 'border-teal-500 bg-teal-100/40' : 'border-line-strong bg-surface-subtle',
              )}
            >
              <input
                ref={fileInput}
                id="import-file"
                name="file"
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
                className="sr-only"
              />

              {fileName ? (
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <FileSpreadsheet className="h-5 w-5 text-content-accent" aria-hidden />
                  <span className="text-body font-bold text-content-primary">{fileName}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setFileName(null)
                      if (fileInput.current) fileInput.current.value = ''
                    }}
                    className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-caption font-bold text-content-secondary hover:bg-surface-raised hover:text-content-primary"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                    Choose a different file
                  </button>
                </div>
              ) : (
                <>
                  <FileUp className="mx-auto h-6 w-6 text-content-secondary" aria-hidden />
                  <p className="mt-2 text-body text-content-primary">
                    Drop your file here, or{' '}
                    <label htmlFor="import-file" className="cursor-pointer font-bold text-content-accent hover:underline">
                      browse for it
                    </label>
                  </p>
                  <p className="mt-1 text-caption text-content-secondary">.xlsx or .csv, up to 5 MB</p>
                </>
              )}
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowPaste((v) => !v)}
                aria-expanded={showPaste}
                className="text-caption font-bold text-content-accent hover:underline"
              >
                {showPaste ? 'Hide the paste box' : 'Or paste rows instead'}
              </button>
              {showPaste && (
                <textarea
                  name="csv"
                  rows={5}
                  aria-label="Paste rows"
                  placeholder={`${headersFor(currency).join(',')}\n${IMPORT_COLUMNS.map((c) => c.example).join(',')}`}
                  className="mt-2 w-full rounded-md border border-line-subtle bg-surface-raised px-3.5 py-3 font-mono text-caption text-content-primary placeholder:text-content-muted"
                />
              )}
            </div>

            {state.message && !state.ok && !preview && (
              <p role="alert" className="text-small text-state-danger">{state.message}</p>
            )}
          </CardBody>
          <CardFooter>
            <span className="text-caption text-content-secondary">Nothing is saved at this step.</span>
            <PreviewButton />
          </CardFooter>
        </form>
      </Card>

      {preview && (
        <Card>
          <CardHeader
            title="3 · Review what will happen"
            description={[
              preview.updateCount > 0 ? `${preview.updateCount} to update` : null,
              preview.createCount > 0 ? `${preview.createCount} to book in` : null,
              preview.unchangedCount > 0 ? `${preview.unchangedCount} unchanged` : null,
              preview.errorCount > 0 ? `${preview.errorCount} to fix` : null,
            ].filter(Boolean).join(' · ') || 'Nothing to do'}
            action={
              preview.errorCount > 0
                ? <Chip tone="danger">Needs attention</Chip>
                : pending > 0
                  ? <Chip tone="accent" dot>Ready to apply</Chip>
                  : <Chip tone="neutral">No changes</Chip>
            }
          />

          <CardBody className="flex flex-col gap-5">
            {(preview.newBrands.length > 0 || preview.newSuppliers.length > 0) && (
              <div className="flex items-start gap-2.5 rounded-md border border-line-subtle bg-surface-subtle px-4 py-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-content-accent" aria-hidden />
                <div className="text-small text-content-secondary">
                  {preview.newBrands.length > 0 && (
                    <p>New brands will be created: <strong className="text-content-primary">{preview.newBrands.join(', ')}</strong></p>
                  )}
                  {preview.newSuppliers.length > 0 && (
                    <p>New suppliers will be created: <strong className="text-content-primary">{preview.newSuppliers.join(', ')}</strong></p>
                  )}
                </div>
              </div>
            )}

            {preview.issues.length > 0 && <IssueList issues={preview.issues} />}

            {preview.rows.length > 0 && (() => {
              // Rows that do something come first. The point of the review step
              // is the handful that changed, and burying them under twenty-odd
              // identical rows is how somebody confirms without reading.
              const rank = { UPDATE: 0, CREATE: 1, UNCHANGED: 2 } as const
              const ordered = [...preview.rows].sort(
                (a, b) => rank[a.action] - rank[b.action] || a.line - b.line,
              )
              const shown = ordered.slice(0, 20)
              return (
                <div className="overflow-hidden rounded-md border border-line-subtle">
                  <Table>
                    <THead>
                      <TR>
                        <TH width="96px">Stock</TH>
                        <TH width="110px">Action</TH>
                        <TH>Watch</TH>
                        <TH>What changes</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {shown.map((row) => (
                        <TR key={row.line}>
                          <TD className="text-content-secondary tabular-nums">
                            {row.stockNo ?? <span className="text-content-tertiary">New</span>}
                          </TD>
                          <TD>
                            {row.action === 'UPDATE' && <Chip tone="accent">Update</Chip>}
                            {row.action === 'CREATE' && <Chip tone="accent" dot>Book in</Chip>}
                            {row.action === 'UNCHANGED' && <Chip tone="neutral">Unchanged</Chip>}
                          </TD>
                          <TD>
                            <span className="block font-bold text-content-primary">{row.brand} {row.model}</span>
                            {row.serial && <span className="block text-caption text-content-secondary">Serial {row.serial}</span>}
                          </TD>
                          <TD className="text-content-secondary">
                            {row.action === 'UPDATE' ? (
                              <ul className="flex flex-col gap-0.5">
                                {row.changes.map((change) => (
                                  <li key={change.field} className="text-caption">
                                    <span className="font-semibold text-content-primary">{change.label}</span>{' '}
                                    <span className="line-through">{change.from}</span>
                                    {' → '}
                                    <span className="font-bold text-content-primary">{change.to}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : row.action === 'CREATE' ? (
                              <span className="text-caption">
                                New purchase · {row.supplier} · {formatDate(row.purchaseDate)} · {money(toMinor(row.purchasePriceGbp ?? 0))}
                              </span>
                            ) : (
                              <span className="text-caption text-content-tertiary">Matches the record exactly</span>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                  {ordered.length > shown.length && (
                    <p className="border-t border-line-subtle px-4 py-2.5 text-caption text-content-secondary">
                      Showing {shown.length} of {ordered.length} rows, changes first.
                    </p>
                  )}
                </div>
              )
            })()}
          </CardBody>

          <CardFooter>
            <span className="text-caption text-content-secondary">
              {preview.errorCount > 0
                ? 'Fix the rows listed above, then send the file again.'
                : pending === 0
                  ? 'Every row matches the inventory. There is nothing to write.'
                  : 'Only the rows listed as changing will be written. Everything else is left alone.'}
            </span>
            <Button onClick={commit} loading={committing} disabled={!canCommit} icon={<Upload className="h-4 w-4" />}>
              {pending === 0 ? 'Nothing to apply' : `Apply ${pending} change${pending === 1 ? '' : 's'}`}
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  )
}

/**
 * Problems, grouped by row.
 *
 * A flat list repeated the row number on every line, so a file with one badly
 * formatted column read as forty separate failures. Grouping makes it obvious
 * that it is four rows with the same mistake rather than forty different ones.
 */
function IssueList({ issues }: {
  issues: Array<{ line: number; field: string; message: string; severity: string }>
}) {
  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity !== 'error')

  const byLine = new Map<number, typeof issues>()
  for (const issue of errors) {
    const list = byLine.get(issue.line) ?? []
    list.push(issue)
    byLine.set(issue.line, list)
  }

  return (
    <div className="flex flex-col gap-3">
      {errors.length > 0 && (
        <div className="rounded-md border border-state-danger/30 bg-state-danger/8">
          <div className="flex items-center gap-2 border-b border-state-danger/20 px-4 py-2.5">
            <AlertTriangle className="h-4 w-4 text-state-danger" aria-hidden />
            <p className="text-small font-bold text-state-danger">
              {byLine.size} row{byLine.size === 1 ? '' : 's'} cannot be imported
            </p>
          </div>
          <ul className="max-h-64 divide-y divide-state-danger/15 overflow-y-auto">
            {[...byLine.entries()].map(([line, lineIssues]) => (
              <li key={line} className="px-4 py-2.5">
                <p className="text-caption font-bold text-content-primary">Row {line}</p>
                <ul className="mt-0.5">
                  {lineIssues.map((issue, index) => (
                    <li key={index} className="text-caption text-content-secondary">
                      <span className="font-semibold">{issue.field}</span> — {issue.message}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-md border border-state-gold/40 bg-state-gold/8 px-4 py-3">
          <p className="text-small font-bold text-content-primary">
            {warnings.length} thing{warnings.length === 1 ? '' : 's'} worth knowing
          </p>
          <ul className="mt-1">
            {warnings.map((issue, index) => (
              <li key={index} className="text-caption text-content-secondary">
                Row {issue.line} · {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function PreviewButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending} icon={<FileUp className="h-4 w-4" />}>
      Check my file
    </Button>
  )
}
