'use client'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { AlertCircle, Camera, Loader2, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, Card, CardBody, CardHeader, SelectField, TextField, useToast } from '@/components/ui'
import { downscaleImage, isUploadableImage } from '@/lib/downscale'
import { toDateInput } from '@/lib/dates'
import { yearFromCard } from '@/lib/card-date'
import { bookInTrayAction, type TrayLine } from '@/app/actions/tray'
import type { TrayReadResponse, TrayRow } from '@/app/api/intake/tray/route'

/** Read larger than the gallery files, because a serial is small in frame. */
const READ_EDGE = 2400

export interface NamedOption { id: string; name: string }

interface Row extends TrayLine {
  key: string
  position: string | null
  unreadable: string | null
  /** False where the maker is not one of ours; the commit creates it. */
  known: boolean
}

/**
 * A tray of watches, booked in from one photograph.
 *
 * Alex, with a picture of four Rolexes on bubble wrap, each beside its own
 * guarantee card: "I would like to be able to drop an image like this
 * somewhere and the system import them accordingly."
 *
 * That is how a delivery arrives — bagged, laid out, photographed before
 * anything is unpacked — and every reference and serial is already in the
 * one picture.
 *
 * Nothing is written until somebody has looked at it. The reading goes into
 * a table, with each row's position in the frame beside it, because the one
 * mistake this can make that costs more than it saves is pairing a card
 * with the wrong watch: two records that each look right and are both
 * wrong, found out when a watch is sold. Position is what makes that
 * checkable at a glance against the photograph.
 */
export function TrayIntake({ suppliers, locations, owners, enabled }: {
  suppliers: NamedOption[]
  locations: NamedOption[]
  owners: NamedOption[]
  enabled: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const input = useRef<HTMLInputElement | null>(null)

  const [reading, setReading] = useState(false)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [supplier, setSupplier] = useState('')
  const [location, setLocation] = useState('')
  const [owner, setOwner] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(toDateInput(new Date()))

  const read = async (files: File[]) => {
    const images = files.filter(isUploadableImage)
    if (images.length === 0) {
      setProblem('That was not a photograph. Drop a picture of the watches laid out.')
      return
    }
    setReading(true)
    setProblem(null)
    setNote(null)

    try {
      const body = new FormData()
      for (const image of images) {
        const { file } = await downscaleImage(image, { maxEdge: READ_EDGE, quality: 0.9 })
        body.append('files', file)
      }
      const response = await fetch('/api/intake/tray', { method: 'POST', body })
      const payload = (await response.json()) as TrayReadResponse & { error?: string }

      if (!response.ok) { setProblem(payload.error ?? 'The reading was refused.'); return }
      if (!payload.configured) {
        setProblem('Reading photographs is not switched on. Connect an API key in Settings → AI and costs.')
        return
      }
      if (payload.watches.length === 0) {
        setProblem(payload.error
          ? `They could not be read — ${payload.error}.`
          : 'No watches could be made out in that photograph.')
        return
      }

      setPreview(URL.createObjectURL(images[0]!))
      setNote(payload.note)
      setRows(payload.watches.map(toRow))
    } catch {
      setProblem('Something went wrong sending that photograph.')
    } finally {
      setReading(false)
    }
  }

  const edit = (key: string, field: keyof TrayLine) => (value: string) =>
    setRows((current) => current?.map((row) => (row.key === key ? { ...row, [field]: value } : row)) ?? null)

  const drop = (key: string) =>
    setRows((current) => current?.filter((row) => row.key !== key) ?? null)

  const book = async () => {
    if (!rows) return
    setSaving(true)
    const result = await bookInTrayAction({
      lines: rows.map(({ key: _key, position: _p, unreadable: _u, known: _k, ...line }) => line),
      supplier, location, owner, purchaseDate,
    })
    setSaving(false)
    if (!result.ok) {
      setProblem(result.message ?? 'They could not be booked in.')
      return
    }
    toast.success('Booked in', result.message)
    router.push('/inventory')
  }

  if (!enabled) return null

  const ready = rows !== null && rows.length > 0 && supplier !== '' && location !== ''
  const missingReference = rows?.some((row) => row.model.trim() === '') ?? false

  return (
    <Card>
      <CardHeader
        title="Book in a tray from one photograph"
        description="A delivery laid out with its cards. Every reference and serial is already in the picture."
      />
      <CardBody className="space-y-4">
        <input
          ref={input}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            if (files.length > 0) void read(files)
          }}
        />

        {rows === null ? (
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              const files = Array.from(event.dataTransfer.files)
              if (files.length > 0) void read(files)
            }}
            className={cn(
              'rounded-lg border border-dashed border-line-strong bg-surface-subtle/40 px-4 py-6 text-center',
              reading && 'opacity-70',
            )}
          >
            {reading ? (
              <p className="flex items-center justify-center gap-2 text-small text-content-secondary">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Reading the tray…
              </p>
            ) : (
              <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                <Camera className="h-4 w-4 text-content-muted" aria-hidden />
                <button
                  type="button"
                  onClick={() => input.current?.click()}
                  className="text-small font-bold text-content-accent hover:underline"
                >
                  Photograph the tray
                </button>
                <span className="text-small text-content-secondary">
                  or drop the picture here. Each watch needs its own card in shot.
                </span>
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start gap-4">
              {preview && (
                // Not the gallery's component: this is not saved and is not a
                // photograph of any one watch — it is what is being read.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="h-28 w-28 rounded-md border border-line-subtle object-cover" />
              )}
              <div className="min-w-[14rem] flex-1 space-y-1">
                <p className="text-small text-content-primary">
                  <span className="font-semibold">{rows.length} {rows.length === 1 ? 'watch' : 'watches'} read. </span>
                  Check each against the picture — the position says where it was — then book them in.
                </p>
                {note && <p className="text-small text-state-warning">{note}</p>}
                <button
                  type="button"
                  onClick={() => { setRows(null); setPreview(null); setNote(null); setProblem(null) }}
                  className="text-small font-bold text-content-accent hover:underline"
                >
                  Start again
                </button>
              </div>
            </div>

            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[54rem] border-separate border-spacing-x-1 border-spacing-y-1.5">
                <thead>
                  <tr className="text-left text-micro uppercase tracking-wide text-content-muted">
                    <th className="font-semibold">Where</th>
                    <th className="font-semibold">Reference</th>
                    <th className="font-semibold">Serial</th>
                    <th className="font-semibold">Brand</th>
                    <th className="font-semibold">Model</th>
                    <th className="font-semibold">Year</th>
                    <th className="font-semibold">Cost</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className="align-top">
                      <td className="w-28 pt-2 text-small text-content-secondary">
                        {row.position ?? '—'}
                        {row.unreadable && (
                          <span className="block text-micro text-state-warning">{row.unreadable}</span>
                        )}
                        <span className="block text-micro text-content-muted">
                          {[row.dial, row.caseMaterial, row.bracelet].filter(Boolean).join(' · ')}
                        </span>
                      </td>
                      <Cell value={row.model} onChange={edit(row.key, 'model')} required />
                      <Cell value={row.serial} onChange={edit(row.key, 'serial')} />
                      <Cell
                        value={row.brand}
                        onChange={edit(row.key, 'brand')}
                        hint={row.known ? undefined : 'new'}
                      />
                      <Cell value={row.modelName} onChange={edit(row.key, 'modelName')} />
                      <Cell value={row.year} onChange={edit(row.key, 'year')} width="w-16" />
                      <Cell value={row.cost} onChange={edit(row.key, 'cost')} width="w-24" />
                      <td className="pt-1.5">
                        <button
                          type="button"
                          aria-label={`Remove the watch at ${row.position ?? 'this position'}`}
                          onClick={() => drop(row.key)}
                          className="rounded p-1.5 text-content-muted hover:bg-surface-subtle hover:text-state-danger"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Said once for the delivery, because that is how one arrives. */}
            <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-2 lg:grid-cols-4">
              <SelectField
                name="supplier" label="Bought from" required value={supplier}
                onChange={(event) => setSupplier(event.target.value)}
                options={[{ value: '', label: 'Choose a supplier…' },
                  ...suppliers.map((s) => ({ value: s.name, label: s.name }))]}
              />
              <SelectField
                name="location" label="Where they are" required value={location}
                onChange={(event) => setLocation(event.target.value)}
                options={[{ value: '', label: 'Choose a location…' },
                  ...locations.map((l) => ({ value: l.name, label: l.name }))]}
              />
              <SelectField
                name="owner" label="Owner" value={owner}
                onChange={(event) => setOwner(event.target.value)}
                options={[{ value: '', label: 'Not recorded yet' },
                  ...owners.map((o) => ({ value: o.name, label: o.name }))]}
              />
              <TextField
                name="purchaseDate" label="Date the shop bought them" type="date" required
                value={purchaseDate}
                onChange={(event) => setPurchaseDate(event.target.value)}
                hint="Not the date on the card, which is when the first owner bought it."
              />
            </div>

            {problem && (
              <p role="alert" className="flex items-start gap-1.5 text-small text-state-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{problem}</span>
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void book()} disabled={!ready || missingReference} loading={saving}>
                Book in {rows.length} {rows.length === 1 ? 'watch' : 'watches'}
              </Button>
              {missingReference && (
                <span className="text-small text-content-secondary">
                  A row with no reference cannot be booked in. Fill it or remove it.
                </span>
              )}
            </div>
          </>
        )}

        {rows === null && problem && (
          <p role="alert" className="flex items-start gap-1.5 text-small text-state-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{problem}</span>
          </p>
        )}
      </CardBody>
    </Card>
  )
}

function Cell({ value, onChange, width = 'w-32', required, hint }: {
  value: string
  onChange: (value: string) => void
  width?: string
  required?: boolean
  hint?: string
}) {
  return (
    <td className="pt-1.5">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={required && value.trim() === '' ? true : undefined}
        className={cn(
          width,
          'h-9 rounded-md border px-2 text-small text-content-primary outline-none',
          'focus:ring-2 focus:ring-inset focus:ring-teal-500',
          required && value.trim() === '' ? 'border-state-danger' : 'border-line-subtle',
        )}
      />
      {hint && <span className="block text-micro text-content-muted">{hint}</span>}
    </td>
  )
}

/**
 * A reading turned into an editable row.
 *
 * The card's date becomes the watch's year and nothing else. What is printed
 * after DATE OF PURCHASE is when the FIRST owner bought it from a retailer,
 * which on a second-hand watch is a different fact from when this shop
 * bought it — and writing it into the purchase date would misdate the stock,
 * the ageing report and every margin worked out from how long it was held.
 */
function toRow(watch: TrayRow): Row {
  return {
    key: `${watch.position ?? ''}-${watch.serial ?? watch.model ?? Math.random()}`,
    position: watch.position,
    unreadable: watch.unreadable,
    known: watch.brandId !== null,
    model: watch.model ?? '',
    serial: watch.serial ?? '',
    brand: watch.brand ?? '',
    modelName: watch.modelName ?? '',
    year: yearFromCard(watch.cardDate),
    dial: watch.dial ?? '',
    caseMaterial: watch.caseMaterial ?? '',
    bracelet: watch.bracelet ?? '',
    cost: '',
  }
}
