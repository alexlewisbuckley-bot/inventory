'use client'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { AlertCircle, Camera, Loader2, Trash2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  Button, Card, CardBody, CardHeader, ComboSelect, SelectField, TextField, useCurrency, useToast,
} from '@/components/ui'
import { downscaleImage, isUploadableImage } from '@/lib/downscale'
import { toDateInput } from '@/lib/dates'
import { yearFromCard } from '@/lib/card-date'
import { createSupplierInlineAction } from '@/app/actions/reference'
import { cropToDataUrl } from '@/lib/crop'
import { BASE_CURRENCY, CURRENCIES, type CurrencyCode } from '@/lib/enums'
import { symbolFor, toBase } from '@/lib/currency'
import { parseMoneyInput } from '@/lib/money'
import { bookInTrayAction, type TrayLine } from '@/app/actions/tray'
import type { TrayReadResponse, TrayRow } from '@/app/api/intake/tray/route'

/** Read larger than the gallery files, because a serial is small in frame. */
const READ_EDGE = 2400

export interface NamedOption { id: string; name: string }

interface Row extends TrayLine {
  key: string
  position: string | null
  unreadable: string | null
  /** The watch cut out of the photograph, where it could be placed. */
  thumb: string | null
  /** A photograph the library already holds for this reference. */
  libraryImageId: string | null
  /** False where the maker is not one of ours; the commit creates it. */
  known: boolean
}

/**
 * A tray of watches, booked in from one photograph.
 *
 * Alex: "I would like to be able to drop an image like this somewhere and
 * the system import them accordingly" — and then, of the first version of
 * this screen: "the cost which currency is it seeking and this could be
 * different for different watches - its also super old fashioned and clunky".
 *
 * Both fair, and the first was not a cosmetic complaint. A bare box marked
 * "cost" took whatever was typed as the shop's base currency, so a watch
 * bought for 28,500 dollars went into the book as 28,500 dirhams — a quarter
 * of its real cost, on a record nothing downstream would ever question.
 * Every amount now carries the currency it was agreed in and says what that
 * comes to in the base, which is what the rest of the application does.
 *
 * The clunk was mostly one column. The reader's account of what it could not
 * make out is genuinely useful — "the first characters are hidden under the
 * watch and glare" is the difference between retyping a serial and going
 * back for another photograph — but it was crammed into a narrow cell beside
 * the position, which turned one row into a ten-line paragraph. It is a line
 * under its own row now.
 *
 * And the row leads with the watch itself, cut out of the photograph. The
 * one mistake this feature can make that costs more than it saves is pairing
 * a card with the wrong watch; "left column, third from top" asks somebody
 * to hold a position in their head and go looking, where a picture of the
 * watch beside the numbers read off its card is a glance.
 */
export function TrayIntake({ suppliers, locations, owners, enabled }: {
  suppliers: NamedOption[]
  locations: NamedOption[]
  owners: NamedOption[]
  enabled: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const { rates, money } = useCurrency()
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
  const [currency, setCurrency] = useState<CurrencyCode>(BASE_CURRENCY)
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
      const sent: File[] = []
      for (const image of images) {
        const { file } = await downscaleImage(image, { maxEdge: READ_EDGE, quality: 0.9 })
        body.append('files', file)
        sent.push(file)
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

      // Cut each watch out of the picture that was actually read, so the
      // boxes and the pixels are in the same coordinate space.
      const thumbs = await Promise.all(
        payload.watches.map((watch) => cropToDataUrl(sent[0]!, watch.box)),
      )

      setPreview(URL.createObjectURL(images[0]!))
      setNote(payload.note)
      setRows(payload.watches.map((watch, index) => toRow(watch, thumbs[index] ?? null, currency)))
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

  /** Changing the batch currency moves every row that has not been set apart. */
  const setBatchCurrency = (next: CurrencyCode) => {
    setCurrency(next)
    setRows((current) => current?.map((row) => ({ ...row, currency: next })) ?? null)
  }

  const book = async () => {
    if (!rows) return
    setSaving(true)
    const result = await bookInTrayAction({
      lines: rows.map(({ key: _k, position: _p, unreadable: _u, thumb: _t, known: _n, ...line }) => line),
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
  const totalBase = (rows ?? []).reduce((total, row) => {
    const minor = parseMoneyInput(row.cost)
    return minor === null ? total : total + toBase(minor, row.currency as CurrencyCode, rates)
  }, 0)
  const priced = (rows ?? []).filter((row) => parseMoneyInput(row.cost) !== null).length
  const dressed = (rows ?? []).filter((row) => row.libraryImageId !== null).length

  return (
    <Card>
      <CardHeader
        title="Book in a tray from one photograph"
        description="A delivery laid out with its cards. Every reference and serial is already in the picture."
      />
      <CardBody className="space-y-5">
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
              'rounded-lg border border-dashed border-line-strong bg-surface-subtle/40 px-4 py-8 text-center',
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
                <img src={preview} alt="" className="h-24 w-24 rounded-md border border-line-subtle object-cover" />
              )}
              <div className="min-w-[16rem] flex-1 space-y-1">
                <p className="text-small text-content-primary">
                  <span className="font-semibold">
                    {rows.length} {rows.length === 1 ? 'watch' : 'watches'} read.
                  </span>{' '}
                  Check each one against its picture, then book them in.
                </p>
                {dressed > 0 && (
                  <p className="text-small text-content-secondary">
                    {dressed} of them {dressed === 1 ? 'has' : 'have'} a photograph in the library already,
                    and will arrive wearing it.
                  </p>
                )}
                {note && (
                  <p className="flex items-start gap-1.5 text-small text-content-secondary">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-state-gold" aria-hidden />
                    <span>{note}</span>
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => { setRows(null); setPreview(null); setNote(null); setProblem(null) }}
                  className="text-small font-bold text-content-accent hover:underline"
                >
                  Start again
                </button>
              </div>
            </div>

            <ul className="flex flex-col gap-2">
              {rows.map((row) => (
                <li
                  key={row.key}
                  className="rounded-lg border border-line-subtle bg-surface-raised px-3 py-2.5"
                >
                  <div className="flex items-start gap-3">
                    {row.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.thumb}
                        alt={`The watch at ${row.position ?? 'this position'}`}
                        className="h-16 w-16 shrink-0 rounded-md border border-line-subtle object-cover"
                      />
                    ) : (
                      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-line-subtle px-1 text-center text-micro text-content-muted">
                        {row.position ?? 'not placed'}
                      </span>
                    )}

                    {row.libraryImageId && (
                      <span className="relative hidden shrink-0 sm:block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/reference-images/${row.libraryImageId}`}
                          alt={`Library photograph for ${row.model}`}
                          className="h-16 w-16 rounded-md border border-line-subtle object-cover"
                        />
                        <span className="absolute inset-x-0 bottom-0 rounded-b-md bg-content-primary/70 py-px text-center text-micro text-surface-raised">
                          library
                        </span>
                      </span>
                    )}

                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
                      <Field label="Reference" value={row.model} onChange={edit(row.key, 'model')} required />
                      <Field label="Serial" value={row.serial} onChange={edit(row.key, 'serial')} />
                      <Field label="Brand" value={row.brand} onChange={edit(row.key, 'brand')}
                        note={row.known ? undefined : 'new to the book'} />
                      <Field label="Model" value={row.modelName} onChange={edit(row.key, 'modelName')} />
                      <Field label="Year" value={row.year} onChange={edit(row.key, 'year')} />
                      <Cost
                        amount={row.cost}
                        currency={row.currency as CurrencyCode}
                        onAmount={edit(row.key, 'cost')}
                        onCurrency={edit(row.key, 'currency')}
                        rates={rates}
                        money={money}
                      />
                    </div>

                    <button
                      type="button"
                      aria-label={`Remove the watch at ${row.position ?? 'this position'}`}
                      onClick={() => drop(row.key)}
                      className="mt-5 shrink-0 rounded p-1.5 text-content-muted hover:bg-surface-subtle hover:text-state-danger"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>

                  {/* Under its own row rather than squeezed beside the
                      position, which turned one watch into a paragraph. */}
                  {row.unreadable && (
                    <p className="mt-1.5 flex items-start gap-1.5 pl-[4.75rem] text-micro text-state-gold">
                      <TriangleAlert className="mt-px h-3 w-3 shrink-0" aria-hidden />
                      <span>{row.unreadable}</span>
                    </p>
                  )}
                </li>
              ))}
            </ul>

            {/* Said once for the delivery, because that is how one arrives. */}
            <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-2 lg:grid-cols-5">
              {/*
                * Creatable, because this is the screen where a delivery is
                * being booked in — and a delivery from somebody new is the
                * ordinary case, not the exception. A plain select meant
                * abandoning the whole tray, going to Suppliers, adding one,
                * and starting the upload again.
                *
                * Keyed by name rather than id: the import resolves suppliers
                * by name, and swapping that here would mean two different
                * answers to what this field is.
                */}
              <ComboSelect
                name="supplier" label="Bought from" required
                value={supplier}
                onChange={setSupplier}
                placeholder="Choose a supplier…"
                options={suppliers.map((s) => ({ value: s.name, label: s.name }))}
                onCreate={async (label) => {
                  const result = await createSupplierInlineAction(label)
                  if (!result.ok) {
                    toast.error('Could not add that supplier', result.message)
                    return null
                  }
                  const name = result.name ?? label.trim()
                  if (result.message) toast.success(result.message)
                  return { value: name, label: name }
                }}
                createLabel="Add supplier"
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
              <SelectField
                name="currency" label="Prices are in"
                value={currency}
                onChange={(event) => setBatchCurrency(event.target.value as CurrencyCode)}
                options={CURRENCIES.map((code) => ({ value: code, label: code }))}
                hint="Sets every row. Change one above if a watch was bought in another."
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

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-4">
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
              {/* What the delivery comes to, because seven costs typed one at
                  a time is the one figure nobody can check by looking. */}
              {priced > 0 && (
                <p className="text-small text-content-secondary">
                  {priced === rows.length ? 'Total' : `${priced} of ${rows.length} priced`}
                  {': '}
                  <span className="font-bold tabular-nums text-content-primary">{money(totalBase)}</span>
                </p>
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

function Field({ label, value, onChange, required, note }: {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  note?: string
}) {
  const empty = required && value.trim() === ''
  return (
    <label className="block min-w-0">
      <span className="block text-micro uppercase tracking-wide text-content-muted">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        aria-invalid={empty ? true : undefined}
        className={cn(
          'mt-0.5 h-9 w-full rounded-md border bg-surface-raised px-2 text-small text-content-primary outline-none',
          'focus:ring-2 focus:ring-inset focus:ring-teal-500',
          empty ? 'border-state-danger' : 'border-line-subtle',
        )}
      />
      {note && <span className="block text-micro text-content-muted">{note}</span>}
    </label>
  )
}

/**
 * An amount and the currency it was agreed in.
 *
 * The whole of Alex's first complaint. A box marked "cost" with nothing
 * beside it took what was typed as the shop's base currency, so a watch
 * bought for 28,500 dollars was booked at 28,500 dirhams and nothing
 * downstream had any reason to doubt it. The converted figure sits under the
 * field for the same reason it does everywhere else here: so that picking
 * the wrong currency is visible rather than silent.
 */
function Cost({ amount, currency, onAmount, onCurrency, rates, money }: {
  amount: string
  currency: CurrencyCode
  onAmount: (value: string) => void
  onCurrency: (value: string) => void
  rates: Record<string, number>
  money: (base: number | null | undefined) => string
}) {
  const minor = parseMoneyInput(amount)
  const base = minor === null ? null : toBase(minor, currency, rates)
  return (
    <label className="block min-w-0">
      <span className="block text-micro uppercase tracking-wide text-content-muted">Cost</span>
      <span className="mt-0.5 flex h-9 items-stretch rounded-md border border-line-subtle bg-surface-raised focus-within:ring-2 focus-within:ring-inset focus-within:ring-teal-500">
        {/* Only where it is a glyph. AED's symbol is the letters AED, and
            the selector beside this already says them. */}
        {symbolFor(currency) !== currency && (
          <span className="flex items-center pl-2 text-small text-content-muted">{symbolFor(currency)}</span>
        )}
        <input
          value={amount}
          onChange={(event) => onAmount(event.target.value)}
          inputMode="decimal"
          aria-label={`Cost in ${currency}`}
          className="w-full min-w-0 bg-transparent px-2 text-small tabular-nums text-content-primary outline-none"
        />
        <select
          value={currency}
          onChange={(event) => onCurrency(event.target.value)}
          aria-label="Currency"
          className="cursor-pointer rounded-r-md border-0 bg-transparent pr-1 text-micro text-content-secondary outline-none"
        >
          {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
      </span>
      {base !== null && currency !== BASE_CURRENCY && (
        <span className="block text-micro text-content-muted">{money(base)}</span>
      )}
    </label>
  )
}

function toRow(watch: TrayRow, thumb: string | null, currency: CurrencyCode): Row {
  return {
    libraryImageId: watch.libraryImageId,
    key: `${watch.position ?? ''}-${watch.serial ?? watch.model ?? Math.random()}`,
    position: watch.position,
    unreadable: watch.unreadable,
    thumb,
    known: watch.brandId !== null,
    model: watch.model ?? '',
    serial: watch.serial ?? '',
    brand: watch.brand ?? '',
    modelName: watch.modelName ?? '',
    // The card's date becomes the watch's year and nothing else: what is
    // printed after DATE OF PURCHASE is when the first owner bought it.
    year: yearFromCard(watch.cardDate),
    dial: watch.dial ?? '',
    caseMaterial: watch.caseMaterial ?? '',
    bracelet: watch.bracelet ?? '',
    cost: '',
    currency,
  }
}
