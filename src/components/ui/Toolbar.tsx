'use client'

import { useId, type ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * The controls that sit above a list.
 *
 * Inventory, sales and the audit trail each grew their own search box, their
 * own select and their own date input, so the three toolbars had different
 * heights, different label placement and different focus behaviour. They are
 * the same three controls doing the same three jobs; they are now the same
 * three components.
 *
 * Every control here is 44px, matching the form fields, so a toolbar mixing a
 * search box with a filter and a button lines up on one baseline.
 */
const CONTROL =
  'h-11 rounded-md border border-line-subtle bg-surface-raised text-content-primary ' +
  'transition-colors hover:border-line-strong disabled:opacity-60 disabled:cursor-not-allowed'

/** A row of toolbar controls, wrapping predictably on narrow screens. */
export function ToolbarRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-2.5', className)}>{children}</div>
}

export function ToolbarSearch({ value, onChange, placeholder, label, className }: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
  className?: string
}) {
  return (
    <div className={cn('relative min-w-[220px] flex-1', className)}>
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-secondary"
        aria-hidden
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        type="search"
        className={cn(CONTROL, 'w-full pl-10 pr-9 text-body placeholder:text-content-muted')}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={`Clear ${label.toLowerCase()}`}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1.5 text-content-secondary transition-colors hover:bg-surface-subtle hover:text-content-primary"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}

/**
 * A labelled select for a toolbar.
 *
 * The label sits inside the control rather than above it, so a toolbar stays
 * one row tall and every control on it shares a baseline. The value is bold
 * against a muted label, which is what makes an applied filter readable at a
 * glance without a separate "filters applied" indicator.
 */
export function ToolbarSelect({ label, value, onChange, options, allLabel = 'All', className }: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  allLabel?: string
  className?: string
}) {
  const id = useId()
  const active = value !== ''

  return (
    <div className={cn('relative', className)}>
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-small text-content-secondary"
      >
        {label}:
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          CONTROL,
          'cursor-pointer appearance-none pr-9 text-small font-bold',
          active && 'border-teal-500',
        )}
        style={{ paddingLeft: `calc(${label.length}ch + 1.9rem)` }}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-secondary"
        aria-hidden
      />
    </div>
  )
}

export function ToolbarDate({ label, value, onChange, className }: {
  label: string
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  const id = useId()
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <label htmlFor={id} className="whitespace-nowrap text-small text-content-secondary">{label}</label>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(CONTROL, 'px-3 text-small', value && 'border-teal-500')}
      />
    </div>
  )
}
