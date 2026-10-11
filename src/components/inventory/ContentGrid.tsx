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
  brandName: string
  model: string
  nickname: string | null
  year: number | null
  dial: string | null
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

  const scored = useMemo(() => rows.map((row) => ({
    row,
    missing: FIELDS.filter((field) => isEmpty(row, field.key)).length,
  })), [rows])

  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase()
    return scored
      .filter(({ row, missing }) => {
        if (onlyGaps && missing === 0) return false
        if (!needle) return true
        return [row.brandName, row.model, row.nickname, String(row.stockNo)]
          .filter(Boolean).join(' ').toLowerCase().includes(needle)
      })
      // Emptiest first. A worklist sorted by stock number is a worklist you
      // read from the top and abandon; sorted by what is missing, the work is
      // where you are looking and the bottom of the list is the finished half.
      .sort((a, b) => b.missing - a.missing || a.row.stockNo - b.row.stockNo)
  }, [scored, term, onlyGaps])

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
        <table className="w-full min-w-[1240px] border-separate border-spacing-0 text-small">
          <thead>
            <tr className="text-left">
              <th className={cn(HEAD, PINNED, 'left-0 w-[52px]')} />
              <th className={cn(HEAD, PINNED, 'left-[52px] w-[66px]')}>Stock</th>
              <th className={cn(HEAD, PINNED, 'left-[118px] w-[104px] shadow-[1px_0_0_rgb(var(--c-border-subtle))]')}>
                Brand
              </th>
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
      <td className={cn(CELL, PINNED, 'left-0 bg-surface-raised group-hover/row:bg-surface-subtle')}>
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
      <td className={cn(CELL, PINNED, 'left-[52px] bg-surface-raised tabular-nums group-hover/row:bg-surface-subtle')}>
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
        className={cn(CELL, PINNED, 'left-[118px] truncate bg-surface-raised text-content-secondary',
          'shadow-[1px_0_0_rgb(var(--c-border-subtle))] group-hover/row:bg-surface-subtle')}
        title={row.brandName}
      >
        {row.brandName}
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
    return <span className="block truncate px-2 py-1.5 text-content-secondary">{current || '—'}</span>
  }

  const listId = options?.length ? `choices-${field.key}` : undefined

  return (
    <div className="relative">
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
          <input
            value={draft ?? current}
            disabled={saving}
            list={listId}
            inputMode={field.numeric ? 'decimal' : undefined}
            aria-label={`${field.label} for stock ${row.stockNo}`}
            placeholder="—"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => void commit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); void commit(event.currentTarget.value) }
              if (event.key === 'Escape') { event.preventDefault(); setDraft(null); event.currentTarget.blur() }
            }}
            className={cn(
              'h-9 w-full border-0 bg-transparent px-2 text-small text-content-primary outline-none',
              'placeholder:text-content-muted hover:bg-surface-subtle',
              'focus:bg-surface-raised focus:ring-2 focus:ring-inset focus:ring-teal-500',
              field.numeric && 'tabular-nums',
              flagged && 'pr-6',
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
const FIELDS: Field[] = [
  { key: 'nickname', label: 'Title', width: 170 },
  { key: 'model', label: 'Reference', width: 118 },
  { key: 'year', label: 'Year', width: 70, numeric: true },
  { key: 'dial', label: 'Dial', width: 118, list: 'dial' },
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
