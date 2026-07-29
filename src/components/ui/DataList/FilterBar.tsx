'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Plus, Search, X } from 'lucide-react'
import { AnchoredMenu } from '../AnchoredMenu'
import { Button } from '../Button'
import { FilterChip } from './FilterChip'
import { useDebounced } from '@/hooks/useDebounced'
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
export function FilterBar({ fields, options, placeholder, actions }: {
  fields: readonly FieldSpec[]
  /** Options for reference fields, keyed by the field's `optionSource`. */
  options?: ReferenceOptions
  placeholder: string
  /** View switcher, column menu — whatever the list puts on the right. */
  actions?: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const addTrigger = useRef<HTMLButtonElement>(null)
  const [adding, setAdding] = useState(false)

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
    const used = clauses.filter((clause) => clause.field === field.key)
    // A field is exhausted once every operator it has is already in play —
    // offering "Cost" a third time when it is already over X and under Y just
    // produces a chip that cannot be satisfied.
    return used.length < operatorsFor(field).length
  })

  const add = (field: FieldSpec) => {
    setAdding(false)
    const taken = new Set(clauses.filter((clause) => clause.field === field.key).map((c) => c.operator))
    const operator = operatorsFor(field).find((candidate) => !taken.has(candidate))
    if (!operator) return

    const choices = optionsFor(field)
    const seed = choices?.[0]?.value
    // Enum and reference filters start on their first value rather than empty,
    // because an empty chip filters nothing and reads as a broken control. Text
    // and number chips open their own editor instead.
    if (operator === 'isEmpty' || operator === 'isNotEmpty') {
      replaceClauses([...clauses, { field: field.key, operator, values: [] }])
      return
    }
    if (seed) {
      replaceClauses([...clauses, { field: field.key, operator, values: [seed] }])
    }
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
    write(next)
  }

  const filtering = clauses.length > 0 || term.length > 0

  return (
    <div className="mb-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[240px] flex-1">
          <span className="sr-only">{placeholder}</span>
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-secondary"
            aria-hidden
          />
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={placeholder}
            className="h-11 w-full rounded-md border border-line-subtle bg-surface-raised pl-10 pr-3.5 text-body text-content-primary transition-colors placeholder:text-content-secondary hover:border-line-strong"
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
              onClose={() => setAdding(false)}
              anchorRef={addTrigger}
              label="Add a filter"
              items={addable.map((field) => ({
                id: field.key,
                label: field.label,
                onSelect: () => add(field),
              }))}
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
