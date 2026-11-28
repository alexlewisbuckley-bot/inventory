'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Plus, Search, X } from 'lucide-react'
import { AnchoredMenu } from '../AnchoredMenu'
import { Button } from '../Button'
import { FilterChip } from './FilterChip'
import { useDebounced } from '@/hooks/useDebounced'
import { cn } from '@/lib/cn'
import {
  applyFilters, operatorsFor, parseFilters,
  type FieldSpec, type FilterClause,
} from '@/lib/filters'

export type ReferenceOptions = Record<string, ReadonlyArray<{ value: string; label: string }>>

/**
 * Search, plus as many filters as the object supports, on one row.
 *
 * V1 gave each list a hand-built toolbar: three fixed dropdowns and a "more
 * filters" disclosure holding whatever else somebody had got round to adding.
 * A filter existed only if a control had been built for it, so "cost over ten
 * thousand and not in the vault" was unaskable — not because the data could
 * not answer it, but because nobody had made that particular pair of widgets.
 *
 * Here the fields are data. `+ Filter` lists everything the object has, the
 * chip that appears knows its own operators from the field's type, and the URL
 * carries the result. Adding a filterable column is one line in
 * `src/lib/filters.ts`.
 */
export function FilterBar({ fields, options, placeholder, actions, hide, quick }: {
  fields: readonly FieldSpec[]
  /** Options for reference fields, keyed by the field's `optionSource`. */
  options?: ReferenceOptions
  placeholder: string
  /** View switcher, column menu — whatever the list puts on the right. */
  actions?: React.ReactNode
  /**
   * Field keys this list already offers somewhere better.
   *
   * Alex, on the stock list: "the filters listed below already can be
   * removed". Seven of the fifteen names in this menu are the facet pills
   * sitting under it — Brand, Model, Dial, Metal, Budget, Size, For — where
   * they are one tap with the counts beside them, against three taps and a
   * typed value here. Two routes to one filter is not twice the power; it
   * is a menu nobody finishes reading.
   */
  hide?: readonly string[]
  /**
   * The few worth showing before "See more".
   *
   * Alex: "For filters keep, location, owner ... and the others hidden with
   * a see more." Everything the object can be filtered by is still here;
   * what changed is that the two anybody reaches for are not at the bottom
   * of a list of fifteen. With none given the whole menu shows, which is
   * what every other list does.
   */
  quick?: readonly string[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const addTrigger = useRef<HTMLButtonElement>(null)
  const [adding, setAdding] = useState(false)
  /** Whether "See more" has been chosen; reset each time the menu closes. */
  const [showAll, setShowAll] = useState(false)
  /** A filter being typed, which is not a filter yet. See `draft` on the chip. */
  const [draft, setDraft] = useState<FilterClause | null>(null)

  const clauses = useMemo(() => parseFilters(params, fields), [params, fields])

  const [term, setTerm] = useState(params.get('q') ?? '')
  const debounced = useDebounced(term, 300)

  const write = (next: URLSearchParams) => {
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  useEffect(() => {
    const current = params.get('q') ?? ''
    if (debounced === current) return
    const next = new URLSearchParams(params.toString())
    if (debounced) next.set('q', debounced)
    else next.delete('q')
    next.delete('page')
    write(next)
    // Only the debounced term drives this; `params` changes identity per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  // Somebody else changed the URL — a saved view, the back button. The input
  // has to follow, or it goes on claiming a search that is no longer applied.
  useEffect(() => {
    const current = params.get('q') ?? ''
    setTerm((existing) => (existing === debounced ? current : existing))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('q')])

  const replaceClauses = (next: FilterClause[]) => write(applyFilters(params, next))

  const optionsFor = (field: FieldSpec) =>
    field.options ?? (field.optionSource ? options?.[field.optionSource] : undefined)

  const addable = fields.filter((field) => {
    // Already offered as a facet pill under this bar, where it is one tap
    // with the counts beside it. Hidden from the menu, not from the list:
    // a clause on it still parses, still shows as a chip and still filters,
    // so a saved view or a shared URL carrying one keeps working.
    if (hide?.includes(field.key)) return false
    const used = clauses.filter((clause) => clause.field === field.key)
    // A field is exhausted once every operator it has is already in play —
    // offering "Cost" a third time when it is already over X and under Y just
    // produces a chip that cannot be satisfied.
    return used.length < operatorsFor(field).length
  })

  /*
   * What the menu shows before "See more" is chosen.
   *
   * Only where a list says which its few are, and only while there is
   * something left to reveal: a "See more" that opens onto one more line is
   * a tap for nothing.
   */
  const front = quick?.length ? addable.filter((field) => quick.includes(field.key)) : addable
  const rest = quick?.length ? addable.filter((field) => !quick.includes(field.key)) : []
  const shown = showAll ? [...front, ...rest] : front

  const add = (field: FieldSpec) => {
    setAdding(false)
    const taken = new Set(clauses.filter((clause) => clause.field === field.key).map((c) => c.operator))
    const operator = operatorsFor(field).find((candidate) => !taken.has(candidate))
    if (!operator) return

    if (operator === 'isEmpty' || operator === 'isNotEmpty') {
      replaceClauses([...clauses, { field: field.key, operator, values: [] }])
      return
    }

    // Enum and reference filters start on their first value rather than empty,
    // because an empty chip filters nothing and reads as a broken control.
    const seed = optionsFor(field)?.[0]?.value
    if (seed) {
      replaceClauses([...clauses, { field: field.key, operator, values: [seed] }])
      return
    }

    // Everything else — a price, a year, a date, a word to match — has no
    // first value worth guessing, and the old code fell off the end of this
    // function when it could not find one. So Cost, Retail, Year, Case size
    // and Bought sat in the menu and did nothing at all when chosen: the menu
    // closed, no chip appeared, and the only reading available was that the
    // whole filter bar was broken. The chip is now created locally with its
    // editor open, and reaches the URL when it has a value.
    setDraft({ field: field.key, operator, values: [] })
  }

  const clear = () => {
    const next = new URLSearchParams()
    // Sorting and column choices are not filters and survive a clear: throwing
    // away somebody's column layout because they removed a status filter is a
    // surprise nobody asked for.
    for (const key of ['sort', 'dir', 'perPage', 'cols', 'view']) {
      const value = params.get(key)
      if (value) next.set(key, value)
    }
    setTerm('')
    setDraft(null)
    write(next)
  }

  const draftField = draft ? fields.find((spec) => spec.key === draft.field) : undefined

  const filtering = clauses.length > 0 || term.length > 0 || draft !== null

  return (
    <div className="mb-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {/*
          Hidden on a phone, where `ListControls` keeps a search box above
          the fold. Two of them would be two inputs for one query string,
          and whichever somebody typed into second would appear to lose
          what they typed into the first.
        */}
        <label className="relative hidden min-w-[240px] flex-1 lg:block">
          <span className="sr-only">{placeholder}</span>
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-secondary"
            aria-hidden
          />
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={placeholder}
            className="h-11 w-full rounded-md border border-line-subtle bg-surface-raised pl-10 pr-3.5 text-body text-content-primary transition-colors placeholder:text-content-muted hover:border-line-strong"
          />
          {term && (
            <button
              type="button"
              onClick={() => setTerm('')}
              aria-label="Clear the search"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm text-content-secondary hover:bg-surface-subtle"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </label>

        {actions}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {clauses.map((clause, index) => {
          const field = fields.find((spec) => spec.key === clause.field)
          if (!field) return null
          return (
            <FilterChip
              key={`${clause.field}-${clause.operator}`}
              clause={clause}
              field={field}
              options={optionsFor(field)}
              onChange={(next) => replaceClauses(clauses.map((c, i) => (i === index ? next : c)))}
              onRemove={() => replaceClauses(clauses.filter((_, i) => i !== index))}
            />
          )
        })}

        {draftField && draft && (
          <FilterChip
            key="draft"
            clause={draft}
            field={draftField}
            options={optionsFor(draftField)}
            draft
            onChange={(next) => {
              setDraft(null)
              replaceClauses([...clauses, next])
            }}
            onRemove={() => setDraft(null)}
          />
        )}

        {addable.length > 0 && (
          <>
            <Button
              ref={addTrigger}
              variant="ghost"
              size="sm"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => setAdding((value) => !value)}
              aria-haspopup="menu"
              aria-expanded={adding}
            >
              Filter
            </Button>
            <AnchoredMenu
              open={adding}
              onClose={() => { setAdding(false); setShowAll(false) }}
              anchorRef={addTrigger}
              label="Add a filter"
              /* A rule between the bands a field belongs to. Fifteen names in
                 one unbroken column is a list to be read; four short groups in
                 the order somebody thinks — where it stands, what it is, what
                 it is worth, what the record still owes — is a menu to be
                 used. No headings: in a menu this short they cost more height
                 than they save. */
              items={[
                ...shown.map((field, index) => ({
                  id: field.key,
                  label: field.label,
                  separated: index > 0 && field.group !== shown[index - 1]?.group,
                  onSelect: () => add(field),
                })),
                // Last, and it does not dismiss the menu: an item whose whole
                // job is to lengthen the list it is in has nothing to show
                // for itself if the list closes in the same breath.
                ...(!showAll && rest.length > 0
                  ? [{
                    id: 'see-more',
                    label: `See ${rest.length} more`,
                    separated: true,
                    keepOpen: true,
                    onSelect: () => setShowAll(true),
                  }]
                  : []),
              ]}
            />
          </>
        )}

        {filtering && (
          <Button variant="ghost" size="sm" onClick={clear}>Clear</Button>
        )}
      </div>
    </div>
  )
}
