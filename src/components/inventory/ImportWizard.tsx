'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormState, useFormStatus } from 'react-dom'
import { AlertTriangle, CheckCircle2, FileUp, Upload } from 'lucide-react'
import {
  Card, CardHeader, CardBody, CardFooter, Button, TextareaField, Chip,
  Table, THead, TBody, TR, TD, TH, useToast,
} from '@/components/ui'
import { previewImportAction, commitImportAction, type ImportPreviewState } from '@/app/actions/watches'
import { formatMoney } from '@/lib/money'
import { formatDate } from '@/lib/dates'
import { toMinor } from '@/lib/money'

const INITIAL: ImportPreviewState = { ok: false }

const TEMPLATE = [
  'Brand,Model,Nickname,Serial,Supplier,Location,Purchase Date,Purchase Price (GBP),Est Sale (USD)',
  'Rolex,126711CHNR,Root Beer,1T41F071,GB Luxury Limited,Own inventory,08/04/2026,13105.51,18650.45',
].join('\n')

/**
 * Two-step import: validate, review, then commit.
 *
 * The preview is the point of the feature — pasting 200 rows and hoping is how
 * inventory data gets corrupted. Errors are listed per line with the reason,
 * and the commit button stays disabled until every one is resolved.
 */
export function ImportWizard({ locationNames }: { locationNames: string[] }) {
  const router = useRouter()
  const toast = useToast()
  const [state, action] = useFormState(previewImportAction, INITIAL)
  const [committing, setCommitting] = useState(false)

  const preview = state.preview
  const canCommit = preview && preview.errorCount === 0 && preview.validCount > 0

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
          title="1 · Provide your data"
          description="Upload a CSV or paste it directly. The first row must be the column headers."
        />
        <form action={action}>
          <CardBody className="flex flex-col gap-5">
            <div>
              <label htmlFor="import-file" className="mb-1.5 block text-caption font-semibold text-content-secondary">
                CSV file
              </label>
              <input
                id="import-file" name="file" type="file" accept=".csv,text/csv"
                className="block w-full rounded-md border border-line-subtle bg-surface-raised px-3.5 py-3 text-body file:mr-4 file:rounded-pill file:border-0 file:bg-navy-700 file:px-4 file:py-2 file:text-caption file:font-bold file:text-white"
              />
            </div>

            <TextareaField
              name="csv" label="…or paste the rows" rows={6}
              placeholder={TEMPLATE}
              hint="Required columns: Brand, Model, Supplier, Location, Purchase Date, Purchase Price (GBP). Optional: Nickname, Serial, Est Sale (USD)."
            />

            <div className="rounded-md bg-surface-subtle px-4 py-3">
              <p className="text-caption font-semibold text-content-secondary">Locations must already exist</p>
              <p className="mt-1 text-caption text-content-secondary">
                {locationNames.join(' · ')}. Brands and suppliers are created automatically if they are new.
              </p>
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
            title="2 · Review what will happen"
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

            {preview.issues.length > 0 && (
              <div className="rounded-md border border-state-danger/30 bg-state-danger/8">
                <div className="flex items-center gap-2 border-b border-state-danger/20 px-4 py-2.5">
                  <AlertTriangle className="h-4 w-4 text-state-danger" aria-hidden />
                  <p className="text-small font-bold text-state-danger">
                    {preview.issues.length} issue{preview.issues.length === 1 ? '' : 's'} found
                  </p>
                </div>
                <ul className="max-h-56 overflow-y-auto px-4 py-3">
                  {preview.issues.map((issue, index) => (
                    <li key={`${issue.line}-${issue.field}-${index}`} className="py-1 text-caption">
                      <span className="font-bold text-content-primary">Line {issue.line}</span>
                      <span className="text-content-secondary"> · {issue.field} — {issue.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.rows.length > 0 && (
              <div className="overflow-hidden rounded-md border border-line-subtle">
                <Table>
                  <THead>
                    <TR>
                      <TH width="60px">Line</TH>
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
                          {formatMoney(toMinor(row.purchasePriceGbp ?? 0), 'GBP')}
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
                : 'Fix the issues above and preview again.'}
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

function PreviewButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="secondary" loading={pending} icon={<FileUp className="h-4 w-4" />}>
      Preview import
    </Button>
  )
}
