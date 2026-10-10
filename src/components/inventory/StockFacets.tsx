'use client'
import { useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/cn'
import { applyFilters, parseFilters, WATCH_FIELDS, type FilterClause } from '@/lib/filters'
import type { FacetGroup } from '@/server/repositories/watch-repository'

/**
 * Finding one watch in a caseful of them.
 *
 * What this replaces was six pills in a row — two genders and four budget
 * ceilings — and it answered none of the questions a dealer is actually
 * asked. "Have you got a Daytona?" was unanswerable from it. "Up to £50,000"
 * matched nearly everything in the book, which makes it a label rather than a
 * filter. And nothing on the row knew what was in stock, so a pill could
 * promise watches under five thousand on a day there were none.
 *
 * Everything here was already askable through `+ Filter`, one field at a time
 * through a menu. That is not the same as being answerable, because the
 * question is asked across a counter with somebody waiting, and a filter you
 * have to assemble while they wait is one that gets answered from memory
 * instead — which is how a watch sits unsold in a drawer.
 *
 * So: the four questions, in the order a conversation has them, each row
 * built from the stock actually held and each option carrying its count. The
 * counts are the point. A row of brands with numbers on tells you where the
 * case is heavy before you have clicked anything, and a number is what makes
 * the difference between offering a choice and offering a guess.
 *
 * FACETED, which is what makes the numbers true: every group is counted under
 * all the OTHER filters and never under its own. Pick Rolex and the models
 * and budgets renarrow to Rolexes, while the brand row still shows Patek with
 * its count — because the thing somebody does straight after picking a brand
 * is change their mind about it.
 *
 * Nothing here is a second kind of filter. Each chip writes exactly the clause
 * the menu would, so it appears as the same removable chip, lives in the same
 * URL, saves into the same view, and composes with everything else.
 */
export function StockFacets({ groups }: { groups: FacetGroup[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const clauses = useMemo(() => parseFilters(params, WATCH_FIELDS), [params])

  /** What is chosen in one group, which is one clause's values. */
  const chosen = (field: string): string[] =>
    clauses.find((clause) => clause.field === field && clause.operator === 'is')?.values ?? []

  /**
   * Add or remove one value within its group.
   *
   * Within a group the values OR, which is what picking two of anything has
   * meant everywhere else in this grammar and what the counts above already
   * assume: Rolex and Patek together means both, not neither. Between groups
   * they AND, so a Rolex Submariner under £25,000 narrows three times.
   *
   * Removing the last value removes the clause rather than leaving an empty
   * one behind, which would filter nothing and show as a chip claiming to.
   */
  const toggle = (field: string, value: string) => {
    const current = chosen(field)
    const next = current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value]

    const rest = clauses.filter((clause) => !(clause.field === field && clause.operator === 'is'))
    const updated: FilterClause[] = next.length > 0
      ? [...rest, { field, operator: 'is', values: next }]
      : rest

    const search = applyFilters(params, updated)
    // Back to the first page: the list underneath is a different list now,
    // and page four of the old one is a blank screen.
    search.delete('page')
    const query = search.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  if (groups.length === 0) return null

  return (
    <div className="mb-5 flex flex-col gap-2.5">
      {groups.map((group) => (
        <FacetRow key={group.field} group={group} chosen={chosen(group.field)} onToggle={toggle} />
      ))}
    </div>
  )
}

/**
 * How many of one group's options are shown before it folds.
 *
 * Five rows of everything is a wall, and the long tail of a model list is
 * mostly families of one or two. The ones that are chosen always show,
 * wherever they fall in the order, or unfolding would be the only way to see
 * what you had already picked.
 */
const SHOWN = 8

function FacetRow({ group, chosen, onToggle }: {
  group: FacetGroup
  chosen: string[]
  onToggle: (field: string, value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const hidden = Math.max(0, group.options.length - SHOWN)
  const shown = open
    ? group.options
    : group.options.filter((option, index) => index < SHOWN || chosen.includes(option.value))

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="w-[72px] shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-content-muted">
        {group.label}
      </span>
      {shown.map((option) => {
        const on = chosen.includes(option.value)
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onToggle(group.field, option.value)}
            aria-pressed={on}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-pill border px-3 text-caption transition-colors',
              on
                ? 'border-content-primary bg-content-primary font-semibold text-surface-raised'
                : 'border-line-subtle bg-surface-raised text-content-secondary hover:border-line-strong hover:text-content-primary',
            )}
          >
            {option.label}
            {/* The count, always. A chip without one offers a choice; a chip
                with one offers an answer, and says which way the case leans
                before anybody has clicked. */}
            <span className={cn('tabular-nums', on ? 'opacity-70' : 'text-content-muted')}>
              {option.count}
            </span>
          </button>
        )
      })}
      {hidden > 0 && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-8 px-1.5 text-caption text-content-secondary underline underline-offset-2 hover:text-content-primary"
        >
          {hidden} more
        </button>
      )}
    </div>
  )
}
