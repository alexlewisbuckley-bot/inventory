'use client'
import { useEffect, useRef, useState } from 'react'
import { FileSpreadsheet, FileText, ImagePlus, Inbox, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, Card } from '@/components/ui'
import { isUploadableImage } from '@/lib/downscale'
import { InvoiceDropZone } from './InvoiceDropZone'
import { ImportWizard } from './ImportWizard'
import { PhotoIntake, type PhotoCandidate } from './PhotoIntake'

type Route = 'invoice' | 'sheet' | 'photographs'

interface Batch {
  route: Route
  files: File[]
}

const SHEET = /\.(xlsx|xlsm|xls|csv|tsv)$/i

/** What a file is, judged by the only two things a drop actually tells you. */
function classify(file: File): Route | null {
  if (SHEET.test(file.name) || file.type.includes('spreadsheet') || file.type === 'text/csv') return 'sheet'
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'invoice'
  if (isUploadableImage(file)) return 'photographs'
  return null
}

const WHAT: Record<Route, { label: string; icon: typeof FileText; blurb: string }> = {
  invoice: {
    label: 'Book in from the invoice',
    icon: FileText,
    blurb: 'The watches on it go straight into stock.',
  },
  sheet: {
    label: 'Import the spreadsheet',
    icon: FileSpreadsheet,
    blurb: 'Nothing is written until you have seen what will happen.',
  },
  photographs: {
    label: 'Attach the photographs',
    icon: ImagePlus,
    blurb: 'Matched to stock by what they are named.',
  },
}

/**
 * One way in.
 *
 * There were three buttons — book in an invoice, import a spreadsheet, add
 * photographs — which is the system's filing cabinet showing through. From
 * where somebody stands they are one errand: here are some files, put them
 * where they go. So the question the page asks is not "which of our three
 * importers did you want" but "what have you got", and the answer is in the
 * files themselves: a PDF is an invoice, a spreadsheet is stock, images are
 * photographs.
 *
 * It only asks when a drop is genuinely ambiguous — one image is as likely to
 * be a scanned invoice as a picture of a watch, while seventy-three images
 * are obviously not seventy-three invoices.
 */
export function StockIntake({ candidates, locationNames, aiEnabled, canImport, canPhotograph }: {
  candidates: PhotoCandidate[]
  locationNames: string[]
  aiEnabled: boolean
  canImport: boolean
  canPhotograph: boolean
}) {
  const [batch, setBatch] = useState<Batch | null>(null)
  /** Groups a mixed drop left for somebody to choose between. */
  const [choices, setChoices] = useState<Batch[] | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)

  const allowed = (route: Route) => (route === 'photographs' ? canPhotograph : canImport)

  const take = (list: FileList | File[] | null) => {
    const files = Array.from(list ?? [])
    if (!files.length) return

    const groups = new Map<Route, File[]>()
    const unknown: File[] = []
    for (const file of files) {
      const route = classify(file)
      if (!route) { unknown.push(file); continue }
      groups.set(route, [...(groups.get(route) ?? []), file])
    }

    // A single image could be either, so it is the one case worth asking
    // about. Several images are photographs and nobody drops two invoices as
    // JPEGs at once.
    const images = groups.get('photographs')
    if (images && images.length === 1 && groups.size === 1 && canImport && canPhotograph) {
      setChoices([{ route: 'photographs', files: images }, { route: 'invoice', files: images }])
      return
    }

    const usable = [...groups.entries()]
      .filter(([route]) => allowed(route))
      .map(([route, group]) => ({ route, files: group }))

    if (usable.length === 0) {
      setChoices(null)
      setBatch(null)
      return
    }
    if (usable.length === 1) { setBatch(usable[0]!); setChoices(null); return }
    // A drop of two kinds at once is rare enough that guessing which was
    // meant first is worse than asking, and quietly dropping half of it is
    // worse than either.
    setChoices(usable)
    void unknown
  }

  // The window is the target, not a rectangle inside it: the gesture people
  // already have is dragging a file out of an email onto a window.
  useEffect(() => {
    if (batch) return
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      setDragging(true)
    }
    const leave = (event: DragEvent) => { if (!event.relatedTarget) setDragging(false) }
    const drop = (event: DragEvent) => {
      event.preventDefault()
      setDragging(false)
      take(event.dataTransfer?.files ?? null)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  })

  const startOver = () => { setBatch(null); setChoices(null) }

  if (batch) {
    const { label } = WHAT[batch.route]
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-small text-content-secondary">
            {batch.files.length === 1
              ? <><span className="font-semibold text-content-primary">{batch.files[0]!.name}</span> — {label.toLowerCase()}</>
              : <><span className="font-semibold text-content-primary">{batch.files.length} files</span> — {label.toLowerCase()}</>}
          </p>
          <Button variant="ghost" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={startOver}>
            Something else
          </Button>
        </div>

        {batch.route === 'invoice' && <InvoiceDropZone aiEnabled={aiEnabled} initialFile={batch.files[0]} />}
        {batch.route === 'sheet' && <ImportWizard locationNames={locationNames} initialFile={batch.files[0]} />}
        {batch.route === 'photographs' && <PhotoIntake candidates={candidates} initialFiles={batch.files} />}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
          onDrop={(e) => { e.preventDefault(); take(e.dataTransfer.files) }}
          className={cn(
            'flex flex-col items-center gap-3 rounded-md border border-dashed px-6 py-14 text-center transition-colors',
            dragging ? 'border-teal-500 bg-teal-100/50' : 'border-line-subtle bg-surface-subtle',
          )}
        >
          <Inbox className="h-7 w-7 text-content-secondary" aria-hidden />
          <div>
            <p className="text-h3 font-extrabold text-content-primary">Drop anything here</p>
            <p className="mx-auto mt-1 max-w-lg text-small text-content-secondary">
              An invoice, a spreadsheet of stock, or a batch of photographs. What it is decides what happens
              — there is nothing to choose first.
            </p>
          </div>
          <Button variant="secondary" onClick={() => input.current?.click()}>Choose files</Button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={(e) => { take(e.target.files); e.target.value = '' }}
          />
        </div>
      </Card>

      {choices ? (
        <Card>
          <div className="border-b border-line-subtle px-5 py-3">
            <p className="text-small font-semibold text-content-primary">
              {choices[0]?.files === choices[1]?.files
                ? 'One image — what is it?'
                : 'More than one kind of file. Which first?'}
            </p>
          </div>
          <ul>
            {choices.map(({ route, files }) => {
              const { label, icon: Icon, blurb } = WHAT[route]
              return (
                <li key={route}>
                  <button
                    type="button"
                    onClick={() => { setBatch({ route, files }); setChoices(null) }}
                    className="flex w-full items-center gap-3 border-t border-line-subtle px-5 py-3 text-left first:border-t-0 hover:bg-surface-subtle"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-content-secondary" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-small font-semibold text-content-primary">{label}</span>
                      <span className="block text-caption text-content-secondary">
                        {files.length === 1 ? files[0]!.name : `${files.length} files`} · {blurb}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-3">
          {(Object.keys(WHAT) as Route[]).filter(allowed).map((route) => {
            const { label, icon: Icon, blurb } = WHAT[route]
            return (
              <li key={route} className="rounded-sm border border-line-subtle bg-surface-raised px-4 py-3">
                <p className="flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.12em] text-content-secondary">
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {route === 'invoice' ? 'A PDF' : route === 'sheet' ? 'A spreadsheet' : 'Images'}
                </p>
                <p className="mt-1.5 text-small text-content-primary">{label}</p>
                <p className="mt-0.5 text-caption text-content-secondary">{blurb}</p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
