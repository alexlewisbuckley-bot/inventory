'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, Camera, Check, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Zoomable, useToast } from '@/components/ui'
import { amendWatchAction } from '@/app/actions/watches'
import {
  BOX_PAPERS, BOX_PAPERS_LABELS, CONDITIONS, CONDITION_LABELS,
} from '@/lib/enums'
import type { ContentField } from '@/lib/validation'

export interface ContentRow {
  id: string
  stockNo: number
  locationName: string
  brandName: string
  model: string
  modelName: string | null
  nickname: string | null
  year: number | null
  dial: string | null
  dialStyle: string | null
  caseMaterial: string | null
  caseSizeMm: number | null
  bracelet: string | null
  movement: string | null
  waterResistanceM: number | null
  condition: string
  boxPapers: string
  description: string | null
  imageId: string | null
}

/**
 * The listing, filled in.
 *
 * Everything the shop shows about a watch is typed here and nowhere else, and
 * until now it was typed one watch at a time through a form behind a drawer.
 * Filling in the dial colour on forty watches meant forty navigations, and
 * what actually happened instead was that it did not get done: a third of the
 * book reached the storefront with no dial recorded, which is a third of the
 * book that cannot be found by anybody browsing for a black dial.
 *
 * So it is a grid, because the job is columnar. One watch per row, one field
 * per column, Tab across, Enter down, and a photograph small enough to say
 * which watch this is and clickable when it is not.
 *
 * The suggestions are the point rather than a nicety. The shop keeps fixed
 * lists for dial, material, bracelet and model, and a value that is not on
 * one is a field filled in and a watch nobody can filter to — "Aubergine" is
 * a real dial on a real watch and the storefront has no such colour. Offering
 * the shop's own words as you type is the difference between filling a field
 * in and filling it in usefully.
 *
 * The warning triangle says the opposite: this value is already recorded and
 * the shop has no entry for it. Computed by the same function the push uses,
 * so the two can never disagree about what counts as matched.
 */
export function ContentGrid({ rows, choices, unmatched, canEdit }: {
  rows: ContentRow[]
  /** The shop's own wording, by metaobject type. */
  choices: Record<string, string[]>
  /** Watch id → the metafield types whose value the shop has no entry for. */
  unmatched: Record<string, string[]>
  canEdit: boolean
}) {
  const [term, setTerm] = useState('')
  const [onlyGaps, setOnlyGaps] = useState(false)
  /**
   * Where the watch is, because not all of it is worth typing yet.
   *
   * A watch still in a courier's bag is not on the website and may not
   * arrive as described, so filling in its dial colour this afternoon is
   * work that may have to be done again. Asked for plainly: "we don't need
   * to update in transit yet".
   */
  const [places, setPlaces] = useState<string[]>([])

  const locations = useMemo(() => {
    const tally = new Map<string, number>()
    for (const row of rows) tally.set(row.locationName, (tally.get(row.locationName) ?? 0) + 1)
    return [...tally.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows])

  const scored = useMemo(() => rows.map((row) => ({
    row,
    missing: FIELDS.filter((field) => isEmpty(row, field.key)).length,
  })), [rows])

  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase()
    return scored
      .filter(({ row, missing }) => {
        if (onlyGaps && missing === 0) return false
        if (places.length > 0 && !places.includes(row.locationName)) return false
        if (!needle) return true
        return [row.brandName, row.model, row.modelName, String(row.stockNo)]
          .filter(Boolean).join(' ').toLowerCase().includes(needle)
      })
      // Emptiest first. A worklist sorted by stock number is a worklist you
      // read from the top and abandon; sorted by what is missing, the work is
      // where you are looking and the bottom of the list is the finished half.
      .sort((a, b) => b.missing - a.missing || a.row.stockNo - b.row.stockNo)
  }, [scored, term, onlyGaps, places])

  const totalGaps = scored.reduce((sum, entry) => sum + entry.missing, 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Search the stock</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-secondary" aria-hidden />
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Stock number, brand or model…"
            className="h-10 w-full rounded-md border border-line-subtle bg-surface-raised pl-10 pr-3 text-small text-content-primary placeholder:text-content-muted hover:border-line-strong"
          />
        </label>
        {locations.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {locations.map(([name, count]) => {
              const on = places.includes(name)
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPlaces((current) => (
                    current.includes(name)
                      ? current.filter((entry) => entry !== name)
                      : [...current, name]
                  ))}
                  className={cn(
                    'inline-flex h-10 items-center gap-1.5 rounded-pill border px-3.5 text-caption transition-colors',
                    on
                      ? 'border-content-primary bg-content-primary text-surface-raised'
                      : 'border-line-subtle bg-surface-raised text-content-secondary hover:border-line-strong',
                  )}
                >
                  {name}
                  <span className={cn('tabular-nums', on ? 'opacity-70' : 'text-content-muted')}>{count}</span>
                </button>
              )
            })}
          </div>
        )}

        <button
          type="button"
          onClick={() => setOnlyGaps((value) => !value)}
          aria-pressed={onlyGaps}
          className={cn(
            'inline-flex h-10 items-center rounded-pill border px-4 text-caption font-semibold transition-colors',
            onlyGaps
              ? 'border-content-primary bg-content-primary text-surface-raised'
              : 'border-line-subtle bg-surface-raised text-content-secondary hover:border-line-strong',
          )}
        >
          Only with gaps
        </button>
        <span className="ml-auto text-caption tabular-nums text-content-secondary">
          <b className="font-semibold text-content-primary">{shown.length}</b> watches
          {totalGaps > 0 && <> · <b className="font-semibold text-content-primary">{totalGaps}</b> empty fields</>}
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border border-line-subtle">
        {/* Separate borders, not collapsed: a collapsed table draws its
            rules on the cells, and a sticky cell then scrolls out from under
            its own left-hand border. */}
        <table className="w-full min-w-[1724px] border-separate border-spacing-0 text-small">
          <thead>
            <tr className="text-left">
              <th className={cn(HEAD, PINNED, PIN_PHOTO)} />
              <th className={cn(HEAD, PINNED, PIN_STOCK)}>Stock</th>
              <th className={cn(HEAD, PINNED, PIN_BRAND)}>Brand</th>
              <th className={cn(HEAD, PINNED, PIN_NAME, EDGE)}>{NAME_FIELD.label}</th>
              {FIELDS.map((field) => (
                <th
                  key={field.key}
                  style={{ width: field.width }}
                  className={HEAD}
                >
                  {field.label}
                </th>
              ))}
              <th className={cn(HEAD, 'w-[56px]')}>Done</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ row, missing }) => (
              <Row
                key={row.id}
                row={row}
                missing={missing}
                choices={choices}
                unmatched={unmatched[row.id] ?? []}
                canEdit={canEdit}
              />
            ))}
          </tbody>
        </table>
      </div>

      {shown.length === 0 && (
        <p className="py-12 text-center text-small text-content-secondary">
          {onlyGaps ? 'Every watch in view is complete.' : 'Nothing matches that.'}
        </p>
      )}
    </div>
  )
}

/**
 * Which watch a row is, kept in view while the columns scroll past it.
 *
 * Thirteen fields do not fit a laptop, and a row whose stock number has
 * scrolled off is a row you are editing blind — which on a screen built for
 * speed is how the wrong watch gets a dial colour.
 */
const PINNED = 'sticky z-10'
/** The rule that separates the frozen block from the half that scrolls. */
const EDGE = 'shadow-[1px_0_0_rgb(var(--c-border-subtle))]'

/**
 * The three frozen columns, each pinned at the exact width of everything to
 * its left.
 *
 * The offsets and the widths have to agree or the freeze comes apart. They
 * used to be declared in two places — a `width` hint on the header and
 * nothing at all on the cell — and a hint is only a hint: the table lays
 * itself out automatically, so "Audemars Piguet" widened the Brand column
 * past the 104px its offset had been calculated from. The sticky cell then
 * reached further right than the column after it began, and the Model name
 * column scrolled underneath it and read "le".
 *
 * Declared once, applied to the header and the cell together, and bounded on
 * both sides so content cannot push them open. 52 + 66 + 132 = 250, which is
 * where the scrolling half of the table starts.
 */
const PIN_PHOTO = 'left-0 w-[52px] min-w-[52px] max-w-[52px]'
const PIN_STOCK = 'left-[52px] w-[62px] min-w-[62px] max-w-[62px]'
// Wide enough for the longest maison in the book — "Audemars Piguet" and
// "Vacheron Constantin" — because a brand column that truncates every
// Audemars is a column you have to hover to read.
const PIN_BRAND = 'left-[114px] w-[118px] min-w-[118px] max-w-[118px]'
/**
 * The model name is frozen too, and that is the point of the whole block.
 *
 * Freezing stopped at the brand, so the first column to slide under it when
 * you scrolled was the model name — the one field that says which watch the
 * row is. Alex, filling in dial and size with the table scrolled right:
 * "second column isn't even visable". It was not a rendering fault; it was
 * the freeze line drawn one column too early.
 *
 * A spreadsheet freezes through the column that names the row, and so does
 * this now: photograph, stock number, maison, model name. Everything to the
 * right is a detail you are filling in, and the row still tells you what you
 * are filling it in for.
 */
const PIN_NAME = 'left-[232px] w-[160px] min-w-[160px] max-w-[160px]'
const HEAD = 'border-b border-line-subtle bg-surface-subtle px-2 py-2 text-caption font-semibold text-content-secondary'
const CELL = 'border-b border-line-subtle px-2 py-1.5'

function Row({ row, missing, choices, unmatched, canEdit }: {
  row: ContentRow
  missing: number
  choices: Record<string, string[]>
  unmatched: string[]
  canEdit: boolean
}) {
  const alt = `Stock ${row.stockNo}, ${row.brandName} ${row.model}`
  return (
    <tr className="group/row">
      <td className={cn(CELL, PINNED, PIN_PHOTO, 'bg-surface-raised group-hover/row:bg-surface-subtle')}>
        {row.imageId ? (
          <Zoomable
            src={`/api/images/${row.imageId}`}
            alt={alt}
            caption={alt}
            className="h-10 w-10 rounded-sm border border-line-subtle object-cover"
          />
        ) : (
          <span
            className="flex h-10 w-10 items-center justify-center rounded-sm bg-surface-subtle text-content-muted"
            title="No photograph"
          >
            <Camera className="h-4 w-4" aria-hidden />
          </span>
        )}
      </td>
      <td className={cn(CELL, PINNED, PIN_STOCK, 'bg-surface-raised tabular-nums group-hover/row:bg-surface-subtle')}>
        {/* The way out to the whole record, for the things a grid cannot
            do — photographs, history, the fields that are not content. */}
        <Link
          href={`/inventory?watch=${row.id}`}
          scroll={false}
          className="font-semibold text-content-primary underline-offset-2 hover:underline"
        >
          {row.stockNo}
        </Link>
      </td>
      <td
        className={cn(CELL, PINNED, PIN_BRAND, 'bg-surface-raised text-content-secondary',
          'shadow-[1px_0_0_rgb(var(--c-border-subtle))] group-hover/row:bg-surface-subtle')}
        title={row.brandName}
      >
        {/*
          The cap lives on this span, not on the cell.
          `max-width` on a table cell is advisory — the table's own layout
          algorithm decides the column, and a long maison wins. The cell had
          `truncate` on it already and "Audemars Piguet" still prised the
          column open, which is what pushed the frozen block past the offset
          the column after it was positioned from. A block element inside the
          cell has an ordinary width that is simply obeyed.
          132px of column, less the 8px of padding each side.
        */}
        <span className="block w-[102px] truncate">{row.brandName}</span>
      </td>
      <td className={cn(PINNED, PIN_NAME, EDGE,
        'border-b border-line-subtle bg-surface-raised p-0 group-hover/row:bg-surface-subtle')}>
        <Cell row={row} field={NAME_FIELD} canEdit={canEdit} flagged={false} />
      </td>

      {FIELDS.map((field) => (
        <td key={field.key} className="border-b border-line-subtle p-0">
          <Cell
            row={row}
            field={field}
            canEdit={canEdit}
            options={field.list ? choices[field.list] ?? [] : undefined}
            flagged={field.list ? unmatched.includes(field.list) : false}
          />
        </td>
      ))}

      <td className={CELL}>
        {missing === 0
          ? <Check className="h-4 w-4 text-state-success" aria-label="Complete" />
          : (
            <span className="tabular-nums text-caption text-content-muted" title={`${missing} fields empty`}>
              {FIELDS.length - missing}/{FIELDS.length}
            </span>
          )}
      </td>
    </tr>
  )
}

/**
 * One field of one watch.
 *
 * Its own small input rather than the table's `InlineEditCell`, because that
 * one is built for a money column in a dense list and opens a locked value
 * deliberately: the point of this screen is that nothing is locked and every
 * cell is one Tab away from the last. Same conventions otherwise — Enter and
 * Tab commit, Escape abandons, clicking away commits.
 */
function Cell({ row, field, options, flagged, canEdit }: {
  row: ContentRow
  field: Field
  options?: string[]
  flagged: boolean
  canEdit: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [focused, setFocused] = useState(false)
  const current = valueOf(row, field.key)

  const commit = async (next: string) => {
    setDraft(null)
    if (next.trim() === current.trim()) return
    setSaving(true)
    const result = await amendWatchAction({ field: 'content', id: row.id, key: field.key, value: next })
    setSaving(false)
    if (!result.ok) {
      toast.error(`Could not set the ${field.label.toLowerCase()}`, result.message ?? 'The change was rejected.')
      return
    }
    router.refresh()
  }

  if (!canEdit) {
    return (
      <span className="block truncate px-2 py-1.5 text-content-secondary" title={current || undefined}>
        {current || '—'}
      </span>
    )
  }

  const listId = options?.length ? `choices-${field.key}` : undefined

  return (
    // A fixed height, because the only child goes absolute when it has the
    // cursor: a wrapper that collapses takes the row's height with it, and
    // the expanded field then hangs below the values it is lined up against.
    <div className="relative h-9">
      {field.options ? (
        <select
          value={current}
          disabled={saving}
          aria-label={`${field.label} for stock ${row.stockNo}`}
          onChange={(event) => void commit(event.target.value)}
          className="h-9 w-full cursor-pointer appearance-none border-0 bg-transparent px-2 text-small text-content-primary outline-none hover:bg-surface-subtle focus:bg-surface-raised focus:ring-2 focus:ring-inset focus:ring-teal-500"
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : (
        <>
          {/*
            A value longer than its column could not be read at all: clipped
            when resting, and still clipped when you clicked into it, so a
            reference like 16204BA.OO.1240BA.01 was a guess. Columns cannot be
            widened enough — the long ones are long — so the cell grows when
            it has the cursor and lies over its neighbours, which is what a
            spreadsheet does and the only thing that scales to the one value
            that is twice everybody else's.

            And a `title`, so the whole of it can be read by hovering without
            entering edit at all.
          */}
          <input
            value={draft ?? current}
            disabled={saving}
            list={listId}
            title={current || undefined}
            inputMode={field.numeric ? 'decimal' : undefined}
            aria-label={`${field.label} for stock ${row.stockNo}`}
            placeholder="—"
            onChange={(event) => setDraft(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={(event) => { setFocused(false); void commit(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); void commit(event.currentTarget.value) }
              if (event.key === 'Escape') { event.preventDefault(); setDraft(null); event.currentTarget.blur() }
            }}
            className={cn(
              'h-9 border-0 bg-transparent px-2 text-small text-content-primary outline-none',
              'placeholder:text-content-muted hover:bg-surface-subtle',
              'focus:bg-surface-raised focus:ring-2 focus:ring-inset focus:ring-teal-500',
              field.numeric && 'tabular-nums',
              flagged && !focused && 'pr-6',
              focused
                // Rightwards over the columns after it, never leftwards: the
                // eye is already at the left edge of the cell and a field
                // that grows under the cursor has moved the thing being read.
                ? 'absolute left-0 top-0 z-30 w-[max(100%,theme(spacing.80))] rounded-sm shadow-overlay'
                : 'w-full',
            )}
          />
          {listId && (
            <datalist id={listId}>
              {options!.map((option) => <option key={option} value={option} />)}
            </datalist>
          )}
          {flagged && (
            <AlertTriangle
              className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-state-warning"
              aria-label="The shop has no entry for this value"
            />
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The columns
// ---------------------------------------------------------------------------

interface Field {
  key: ContentField
  label: string
  width: number
  numeric?: boolean
  /** The shop's metaobject type, where this field has a list behind it. */
  list?: string
  /** A closed list of our own, rendered as a select rather than typed. */
  options?: Array<{ value: string; label: string }>
}

/**
 * Every field the storefront reads, in the order somebody fills them in.
 *
 * Title first, because it is the line a customer reads and the one most often
 * wrong; then the reference, which is what they search. The structured fields
 * follow in the order they are read off a watch sitting on the desk — dial,
 * case, bracelet, movement — and the two judgements come last.
 *
 * `description` is deliberately not here. It is prose, it belongs in a
 * textarea, and a column wide enough to write it in would squeeze the eleven
 * fields that are two words long. The stock number links out to the record.
 */
/**
 * Frozen, so it is rendered apart from the rest — but still a Field, so it is
 * still an editable cell with the same behaviour as every other.
 */
const NAME_FIELD: Field = { key: 'modelName', label: 'Model name', width: 160 }

const FIELDS: Field[] = [
  // First of the scrolling half, beside the frozen model name, because the
  // two are read together: "Submariner Date" and "Hulk" are one thought.
  { key: 'nickname', label: 'Nickname', width: 120 },
  { key: 'model', label: 'Reference', width: 142 },
  { key: 'year', label: 'Year', width: 70, numeric: true },
  { key: 'dial', label: 'Dial', width: 108, list: 'dial' },
  // Colour then markers, in that order, because that is how a dial is
  // described out loud: "blue baton", not "baton blue".
  { key: 'dialStyle', label: 'Dial style', width: 112, list: 'dial_style' },
  { key: 'caseMaterial', label: 'Material', width: 132, list: 'material' },
  { key: 'caseSizeMm', label: 'Size', width: 70, numeric: true },
  { key: 'bracelet', label: 'Bracelet', width: 110, list: 'bracelet' },
  { key: 'movement', label: 'Movement', width: 110 },
  { key: 'waterResistanceM', label: 'Water', width: 70, numeric: true },
  {
    key: 'condition',
    label: 'Condition',
    width: 108,
    options: CONDITIONS.map((value) => ({ value, label: CONDITION_LABELS[value] })),
  },
  {
    key: 'boxPapers',
    label: 'Box & papers',
    width: 124,
    options: BOX_PAPERS.map((value) => ({ value, label: BOX_PAPERS_LABELS[value] })),
  },
]

function valueOf(row: ContentRow, key: ContentField): string {
  const value = row[key as keyof ContentRow]
  if (value === null || value === undefined) return ''
  return String(value)
}

/**
 * Whether a field still needs filling in.
 *
 * "Unknown" counts as empty for the two closed lists, because it is what a
 * record says before anybody has looked — not a decision somebody made.
 */
function isEmpty(row: ContentRow, key: ContentField): boolean {
  if (key === 'condition') return row.condition === 'UNKNOWN'
  if (key === 'boxPapers') return row.boxPapers === 'UNKNOWN'
  return valueOf(row, key).trim() === ''
}
