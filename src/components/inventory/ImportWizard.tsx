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
import { IMPORT_COLUMNS } from '@/lib/import-columns'
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
  const { money } = useCurrency()
  const [state, action] = useFormState(previewImportAction, INITIAL)
  const [committing, setCommitting] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [showPaste, setShowPaste] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const preview = state.preview
  const canCommit = preview && preview.errorCount === 0 && preview.validCount > 0

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
              Download the Excel template
            </LinkButton>
            <a
              href="/api/import/template?format=csv"
              className="inline-flex items-center gap-1.5 text-small font-bold text-content-accent hover:underline"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Or a plain CSV
            </a>
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
                    <TR key={column.header}>
                      <TD className="font-bold text-content-primary">{column.header}</TD>
                      <TD>
                        <Chip tone={column.required ? 'navy' : 'neutral'}>
                          {column.required ? 'Required' : 'Optional'}
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
                  placeholder={`${IMPORT_COLUMNS.map((c) => c.header).join(',')}\n${IMPORT_COLUMNS.map((c) => c.example).join(',')}`}
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
            description={`${preview.validCount} row${preview.validCount === 1 ? '' : 's'} ready · ${preview.errorCount} to fix`}
            action={
              preview.errorCount === 0
                ? <Chip tone="accent" dot>Ready to import</Chip>
                : <Chip tone="danger">Needs attention</Chip>
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

            {preview.rows.length > 0 && (
              <div className="overflow-hidden rounded-md border border-line-subtle">
                <Table>
                  <THead>
                    <TR>
                      <TH width="60px">Row</TH>
                      <TH>Watch</TH>
                      <TH width="140px">Supplier</TH>
                      <TH width="140px">Location</TH>
                      <TH width="110px">Purchased</TH>
                      <TH width="110px" align="right">Cost</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {preview.rows.slice(0, 20).map((row) => (
                      <TR key={row.line}>
                        <TD className="text-content-secondary">{row.line}</TD>
                        <TD>
                          <span className="block font-bold text-content-primary">{row.brand} {row.model}</span>
                          {row.serial && <span className="block text-caption text-content-secondary">Serial {row.serial}</span>}
                        </TD>
                        <TD className="text-content-secondary">{row.supplier}</TD>
                        <TD className="text-content-secondary">{row.location}</TD>
                        <TD className="text-content-secondary">{formatDate(row.purchaseDate)}</TD>
                        <TD align="right" className="font-bold">
                          {money(toMinor(row.purchasePriceGbp ?? 0))}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                {preview.rows.length > 20 && (
                  <p className="border-t border-line-subtle px-4 py-2.5 text-caption text-content-secondary">
                    Showing the first 20 of {preview.rows.length} rows. All of them will be imported.
                  </p>
                )}
              </div>
            )}
          </CardBody>

          <CardFooter>
            <span className="text-caption text-content-secondary">
              {canCommit
                ? 'Stock numbers are allocated automatically, continuing your existing sequence.'
                : 'Fix the rows listed above, then send the file again.'}
            </span>
            <Button onClick={commit} loading={committing} disabled={!canCommit} icon={<Upload className="h-4 w-4" />}>
              Import {preview.validCount} {preview.validCount === 1 ? 'watch' : 'watches'}
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
