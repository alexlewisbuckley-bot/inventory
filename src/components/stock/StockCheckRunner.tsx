'use client'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, CircleSlash, ImageOff, MapPin, ScanLine, Undo2, XCircle } from 'lucide-react'
import {
  Button, Card, CardBody, CardHeader, Chip, ConfirmDialog, Modal, SelectField,
  TextareaField, ToolbarRow, ToolbarSearch, ToolbarSelect, useCurrency, useToast,
} from '@/components/ui'
import {
  abandonStockCheckAction, completeStockCheckAction, recordLineAction, scanForCheckAction,
} from '@/app/actions/stock-checks'
import {
  STOCK_CHECK_LINE_STATUS_LABELS, STOCK_CHECK_LINE_TONE,
  type StockCheckLineStatus,
} from '@/lib/enums'
import { cn } from '@/lib/cn'

export interface StockCheckLineRow {
  id: string
  watchId: string
  status: StockCheckLineStatus
  notes: string | null
  checkedByName: string | null
  expectedLocationName: string | null
  foundLocationName: string | null
  stockNo: number
  model: string
  serial: string | null
  brandName: string
  /** Identified by eye before by serial — see WatchThumb. */
  primaryImageId: string | null
  purchasePriceGbp: number
}

export interface StockCheckRunnerProps {
  checkId: string
  reference: string
  open: boolean
  lines: StockCheckLineRow[]
  locations: Array<{ id: string; name: string }>
  canCount: boolean
  /** Whether this role may be told what the unaccounted-for stock cost. */
  canSeeCost: boolean
}

type Filter = 'outstanding' | 'counted' | 'problems' | 'all'

/**
 * Working through the stock, one watch at a time.
 *
 * Built around the scan box rather than the list. Somebody counting a safe has
 * a watch in one hand and a phone in the other; the interaction that has to be
 * fast is "read the serial, confirm it, move on", and a list of four hundred
 * tick boxes makes that the slowest thing on the screen. The list is there for
 * the end of the count — what is left, and what went wrong — which is when a
 * list is the right shape.
 */
export function StockCheckRunner({
  checkId, reference, open, lines, locations, canCount, canSeeCost,
}: StockCheckRunnerProps) {
  const router = useRouter()
  const toast = useToast()
  const { money } = useCurrency()
  const scanBox = useRef<HTMLInputElement>(null)

  const [term, setTerm] = useState('')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<Filter>(open ? 'outstanding' : 'problems')
  const [search, setSearch] = useState('')
  const [elsewhereFor, setElsewhereFor] = useState<StockCheckLineRow | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [abandoning, setAbandoning] = useState(false)
  /** The last few scans, newest first — the feedback that makes speed safe. */
  const [recent, setRecent] = useState<Array<{ ok: boolean; message: string }>>([])
  /**
   * The watch just counted, kept so its photograph can be shown back.
   *
   * Reading "Stock 1143 counted" confirms the software did something. Seeing
   * the watch confirms it was the right one, which is the mistake that
   * actually happens: two references a digit apart, one tray, one hurry.
   */
  const [lastCounted, setLastCounted] = useState<{ imageId: string | null; label: string; stockNo: number } | null>(null)
  /** Rows to work down, or photographs to pick out. */
  const [layout, setLayout] = useState<'rows' | 'photos'>('rows')

  const tally = useMemo(() => ({
    pending: lines.filter((l) => l.status === 'PENDING').length,
    found: lines.filter((l) => l.status === 'FOUND').length,
    elsewhere: lines.filter((l) => l.status === 'FOUND_ELSEWHERE').length,
    missing: lines.filter((l) => l.status === 'MISSING').length,
  }), [lines])

  const counted = lines.length - tally.pending
  const progress = lines.length > 0 ? Math.round((counted / lines.length) * 100) : 0

  // What the gap is worth. "Three missing" is a fact; "three missing,
  // $47,000" is the sentence that decides whether somebody stops what they
  // are doing, and it is the first thing an owner asks.
  // How much of this check can actually be done by eye. Picking a watch out of
  // a grid only works where there is something to look at, and a wall of
  // identical placeholders is worse than a list of references — so the screen
  // says which it is rather than letting somebody conclude it is broken.
  const photographed = useMemo(
    () => lines.filter((line) => line.primaryImageId).length,
    [lines],
  )

  const unaccountedValue = useMemo(
    () => lines
      .filter((line) => line.status === 'MISSING')
      .reduce((total, line) => total + line.purchasePriceGbp, 0),
    [lines],
  )

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return lines.filter((line) => {
      if (filter === 'outstanding' && line.status !== 'PENDING') return false
      if (filter === 'counted' && line.status === 'PENDING') return false
      if (filter === 'problems' && line.status !== 'MISSING' && line.status !== 'FOUND_ELSEWHERE') return false
      if (!needle) return true
      return [String(line.stockNo), line.brandName, line.model, line.serial]
        .some((field) => field?.toLowerCase().includes(needle))
    })
  }, [lines, filter, search])

  const scan = async (event: React.FormEvent) => {
    event.preventDefault()
    const value = term.trim()
    if (!value || busy) return

    setBusy(true)
    const result = await scanForCheckAction(checkId, value)
    setBusy(false)

    setRecent((previous) => [{ ok: result.ok, message: result.message }, ...previous].slice(0, 5))
    if (result.ok && result.line) {
      setLastCounted({
        imageId: result.line.primaryImageId,
        label: result.line.label,
        stockNo: result.line.stockNo,
      })
    }
    // Cleared and refocused either way: the next watch is already in hand, and
    // making somebody dismiss an error before scanning again is what turns a
    // fast job into a slow one.
    setTerm('')
    scanBox.current?.focus()
    if (result.ok) router.refresh()
  }

  const mark = async (line: StockCheckLineRow, status: StockCheckLineStatus) => {
    setBusy(true)
    const result = await recordLineAction(checkId, line.watchId, status, null, null, false)
    setBusy(false)
    if (result.ok) router.refresh()
    else toast.error('Could not record that', result.message)
  }

  const finish = async () => {
    setBusy(true)
    const result = await completeStockCheckAction(checkId)
    setBusy(false)
    setFinishing(false)
    if (result.ok) {
      toast.success('Stock check completed', result.message)
      router.refresh()
    } else {
      toast.error('Could not complete it', result.message)
    }
  }

  const abandon = async () => {
    setBusy(true)
    const result = await abandonStockCheckAction(checkId, null)
    setBusy(false)
    setAbandoning(false)
    if (result.ok) {
      toast.success(result.message ?? 'Abandoned')
      router.refresh()
    } else {
      toast.error('Could not abandon it', result.message)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Progress"
          description={`${counted} of ${lines.length} counted`}
          action={open && canCount ? (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAbandoning(true)} disabled={busy}>
                Abandon
              </Button>
              <Button size="sm" onClick={() => setFinishing(true)} disabled={busy}>
                Complete the check
              </Button>
            </div>
          ) : undefined}
        />
        <CardBody>
          <div
            className="h-2 w-full overflow-hidden rounded-pill bg-surface-subtle"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Stock counted"
          >
            <div className="h-full rounded-pill bg-state-good transition-all" style={{ width: `${progress}%` }} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chip tone="good" dot>{tally.found} found</Chip>
            {tally.elsewhere > 0 && <Chip tone="warning" dot>{tally.elsewhere} elsewhere</Chip>}
            {tally.missing > 0 && <Chip tone="critical" dot>{tally.missing} missing</Chip>}
            {canSeeCost && unaccountedValue > 0 && (
              <Chip tone="critical">{money(unaccountedValue)} unaccounted for</Chip>
            )}
            <Chip tone="neutral">{tally.pending} to go</Chip>
          </div>
        </CardBody>
      </Card>

      {open && canCount && (
        <Card>
          <CardHeader
            title="Count one"
            description="Read the serial off the back, or the stock number off the tray label."
          />
          <CardBody>
            <form onSubmit={scan} className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[240px] flex-1">
                <ScanLine
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-secondary"
                  aria-hidden
                />
                <input
                  ref={scanBox}
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  // Focused on arrival: the first thing anybody does on this
                  // screen is scan, and a barcode reader types into whatever
                  // has focus.
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Serial or stock number"
                  placeholder="Serial or stock number…"
                  className="h-11 w-full rounded-md border border-line-subtle bg-surface-raised pl-10 pr-3 text-body text-content-primary placeholder:text-content-muted focus:border-teal-500 focus:outline-none"
                />
              </div>
              <Button type="submit" loading={busy}>Count it</Button>
            </form>

            {lastCounted && (
              <div className="mt-4 flex items-center gap-3 rounded-md border border-state-good/40 bg-state-good/8 p-3">
                <WatchThumb
                  imageId={lastCounted.imageId}
                  alt={lastCounted.label}
                  className="h-16 w-16 shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-caption font-semibold text-state-good">Just counted</p>
                  <p className="truncate text-small font-bold text-content-primary">
                    {lastCounted.stockNo} · {lastCounted.label}
                  </p>
                  <p className="text-caption text-content-secondary">
                    Not the one in your hand? Find it in the list below and undo it.
                  </p>
                </div>
              </div>
            )}

            {recent.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1" aria-live="polite">
                {recent.map((entry, index) => (
                  <li
                    key={`${entry.message}-${index}`}
                    className={cn(
                      'flex items-center gap-2 text-caption',
                      index === 0 ? 'font-semibold' : 'text-content-secondary',
                      entry.ok ? 'text-state-good' : 'text-state-critical',
                    )}
                  >
                    {entry.ok
                      ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      : <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                    {entry.message}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-line-subtle px-6 py-3">
          <ToolbarRow>
            <ToolbarSearch
              value={search}
              onChange={setSearch}
              label="Search this check"
              placeholder="Stock number, brand, model or serial…"
            />
            <ToolbarSelect
              label="Show"
              value={filter}
              onChange={(value) => setFilter(value as Filter)}
              options={[
                { value: 'outstanding', label: `Still to count (${tally.pending})` },
                { value: 'problems', label: `Needs attention (${tally.missing + tally.elsewhere})` },
                { value: 'counted', label: `Counted (${counted})` },
                { value: 'all', label: `Everything (${lines.length})` },
              ]}
            />
            <ToolbarSelect
              label="As"
              value={layout}
              onChange={(value) => setLayout(value as 'rows' | 'photos')}
              options={[
                { value: 'rows', label: 'Rows' },
                { value: 'photos', label: 'Photographs' },
              ]}
            />
          </ToolbarRow>

          {layout === 'photos' && photographed < lines.length && (
            <p className="mt-2 text-caption text-content-secondary">
              {photographed === 0
                ? 'None of this stock has been photographed yet, so there is nothing to pick out by eye. Rows will be quicker until photographs are added.'
                : `${photographed} of ${lines.length} have a photograph. The rest show their stock number instead.`}
            </p>
          )}
        </div>

        {visible.length === 0 ? (
          <p className="px-6 py-10 text-center text-content-secondary">
            {filter === 'outstanding' && tally.pending === 0
              ? 'Everything on this check has been counted.'
              : 'Nothing here matches that.'}
          </p>
        ) : layout === 'photos' ? (
          /*
           * Pick the one in your hand.
           *
           * For a tray of watches this beats reading serials: recognising a
           * green bezel is instant, and finding "0SQ84951" among four hundred
           * is not. Tapping counts it outright — the confirmation is the card
           * turning green under your thumb, which is the whole point of doing
           * it by eye.
           */
          <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visible.map((line) => (
              <li key={line.id}>
                <button
                  type="button"
                  onClick={() => (open && canCount && line.status === 'PENDING'
                    ? mark(line, 'FOUND')
                    : undefined)}
                  disabled={busy || !open || !canCount || line.status !== 'PENDING'}
                  aria-label={line.status === 'PENDING'
                    ? `Count stock ${line.stockNo}, ${line.brandName} ${line.model}`
                    : `Stock ${line.stockNo} — ${STOCK_CHECK_LINE_STATUS_LABELS[line.status]}`}
                  className={cn(
                    'flex h-full w-full flex-col overflow-hidden rounded-md border text-left transition-colors',
                    line.status === 'PENDING'
                      ? 'border-line-subtle hover:border-teal-500 hover:bg-teal-100/40'
                      : 'border-line-subtle opacity-70',
                  )}
                >
                  <WatchThumb
                    imageId={line.primaryImageId}
                    alt={`${line.brandName} ${line.model}`}
                    className="aspect-square w-full"
                  />
                  <span className="flex flex-1 flex-col gap-0.5 p-2.5">
                    <span className="text-caption font-bold text-navy-700">{line.stockNo}</span>
                    <span className="truncate text-caption text-content-primary">{line.brandName}</span>
                    <span className="truncate text-micro text-content-secondary">{line.model}</span>
                    {line.status !== 'PENDING' && (
                      <span className="mt-1">
                        <Chip tone={STOCK_CHECK_LINE_TONE[line.status]} dot>
                          {STOCK_CHECK_LINE_STATUS_LABELS[line.status]}
                        </Chip>
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {visible.map((line) => (
              <li key={line.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
                <WatchThumb
                  imageId={line.primaryImageId}
                  alt={`${line.brandName} ${line.model}`}
                  className="h-12 w-12 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/inventory/${line.watchId}`}
                      className="text-small font-bold text-navy-700 hover:underline"
                    >
                      {line.stockNo}
                    </Link>
                    <span className="truncate text-small text-content-primary">
                      {line.brandName} {line.model}
                    </span>
                  </div>
                  <p className="truncate text-caption text-content-secondary">
                    {line.serial ? `Serial ${line.serial}` : 'No serial recorded'}
                    {line.expectedLocationName && ` · expected at ${line.expectedLocationName}`}
                    {line.foundLocationName && ` · found at ${line.foundLocationName}`}
                    {line.checkedByName && ` · by ${line.checkedByName}`}
                  </p>
                </div>

                <Chip tone={STOCK_CHECK_LINE_TONE[line.status]} dot={line.status !== 'PENDING'}>
                  {STOCK_CHECK_LINE_STATUS_LABELS[line.status]}
                </Chip>

                {open && canCount && (
                  <div className="flex items-center gap-1">
                    <LineButton
                      label="Found"
                      icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                      onClick={() => mark(line, 'FOUND')}
                      disabled={busy}
                    />
                    <LineButton
                      label="Elsewhere"
                      icon={<MapPin className="h-3.5 w-3.5" />}
                      onClick={() => setElsewhereFor(line)}
                      disabled={busy}
                    />
                    <LineButton
                      label="Missing"
                      icon={<CircleSlash className="h-3.5 w-3.5" />}
                      onClick={() => mark(line, 'MISSING')}
                      disabled={busy}
                      tone="critical"
                    />
                    {/* The wrong row is the easiest mistake to make at speed,
                        and v1 had no way back to "not counted" — only a way to
                        overwrite one wrong answer with another. */}
                    {line.status !== 'PENDING' && (
                      <LineButton
                        label="Undo"
                        icon={<Undo2 className="h-3.5 w-3.5" />}
                        onClick={() => mark(line, 'PENDING')}
                        disabled={busy}
                      />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <FoundElsewhereModal
        line={elsewhereFor}
        checkId={checkId}
        locations={locations}
        onClose={() => setElsewhereFor(null)}
        onDone={() => { setElsewhereFor(null); router.refresh() }}
      />

      <ConfirmDialog
        open={finishing}
        onCancel={() => setFinishing(false)}
        onConfirm={finish}
        loading={busy}
        title={`Complete ${reference}?`}
        message={tally.pending === 0
          ? 'Everything has been counted. Completing writes the result and closes the check.'
          : `${tally.pending} ${tally.pending === 1 ? 'watch has' : 'watches have'} not been counted. `
            + 'Completing records them as missing — nothing is written off, but they will be '
            + 'reported as unaccounted for.'}
        confirmLabel="Complete the check"
      />

      <ConfirmDialog
        open={abandoning}
        onCancel={() => setAbandoning(false)}
        onConfirm={abandon}
        loading={busy}
        title={`Abandon ${reference}?`}
        message="The check is closed without a result and nothing is recorded against the stock. Use this when a count was started by mistake."
        confirmLabel="Abandon it"
      />
    </div>
  )
}

/**
 * A watch, small.
 *
 * Lazy, because a check can carry four hundred of these and only the ones on
 * screen are worth fetching. The empty state is a plain frame rather than a
 * broken image: most stock has no photograph yet, and a wall of broken icons
 * would make the feature look broken instead of the data look incomplete.
 */
function WatchThumb({ imageId, alt, className }: {
  imageId: string | null
  alt: string
  className?: string
}) {
  if (!imageId) {
    return (
      <span
        className={cn(
          'flex items-center justify-center rounded-sm bg-surface-subtle text-content-muted',
          className,
        )}
        aria-hidden
      >
        <ImageOff className="h-4 w-4" />
      </span>
    )
  }
  return (
    <img
      src={`/api/images/${imageId}`}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cn('rounded-sm bg-surface-subtle object-cover', className)}
    />
  )
}

function LineButton({ label, icon, onClick, disabled, tone }: {
  label: string
  icon: React.ReactNode
  onClick: () => void
  disabled: boolean
  tone?: 'critical'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-sm border border-line-subtle px-2.5 text-caption font-semibold transition-colors disabled:opacity-50',
        tone === 'critical'
          ? 'text-content-secondary hover:border-state-critical/50 hover:bg-state-critical/8 hover:text-state-critical'
          : 'text-content-secondary hover:border-line-strong hover:text-content-primary',
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

/**
 * Found, but not where it should be.
 *
 * Offers to move the record, and does not assume it. The person holding the
 * watch knows whether it is going back to the vault or staying in the window,
 * and a count that rearranged the stock record as a side effect of looking at
 * it would be worse than one that only reports.
 */
function FoundElsewhereModal({ line, checkId, locations, onClose, onDone }: {
  line: StockCheckLineRow | null
  checkId: string
  locations: Array<{ id: string; name: string }>
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [locationId, setLocationId] = useState('')
  const [move, setMove] = useState(true)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!line) return
    if (!locationId) {
      toast.error('Choose where it actually is')
      return
    }
    setBusy(true)
    const result = await recordLineAction(checkId, line.watchId, 'FOUND', locationId, notes || null, move)
    setBusy(false)
    if (result.ok) {
      toast.success(result.message ?? 'Recorded')
      setLocationId('')
      setNotes('')
      onDone()
    } else {
      toast.error('Could not record that', result.message)
    }
  }

  return (
    <Modal
      open={line !== null}
      onClose={onClose}
      title={line ? `Stock ${line.stockNo} found elsewhere` : 'Found elsewhere'}
      description={line?.expectedLocationName
        ? `Expected at ${line.expectedLocationName}.`
        : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy}>Record it</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SelectField
          name="foundLocationId"
          label="Where it actually is"
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          options={[
            { value: '', label: 'Choose a location…' },
            ...locations.map((location) => ({ value: location.id, label: location.name })),
          ]}
        />
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={move}
            onChange={(event) => setMove(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded-xs accent-teal-500"
          />
          <span>
            <span className="block text-small font-semibold text-content-primary">
              Move the record to match
            </span>
            <span className="block text-caption text-content-secondary">
              Updates the watch and logs a movement. Leave this off if it is going back where it
              belongs.
            </span>
          </span>
        </label>
        <TextareaField
          name="notes"
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Anything worth recording about where it turned up."
        />
      </div>
    </Modal>
  )
}
