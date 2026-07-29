'use client'
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Field } from './Field'

export interface ComboOption { value: string; label: string }

export interface ComboSelectProps {
  name: string
  label?: string
  hint?: React.ReactNode
  error?: string
  required?: boolean
  className?: string
  placeholder?: string
  options: ComboOption[]
  value: string
  onChange: (value: string) => void
  /**
   * Called when the user asks to create the typed value. Returning the new
   * option adds it to the list and selects it. Omit to disable creation.
   */
  onCreate?: (label: string) => Promise<ComboOption | null>
  createLabel?: string
  /**
   * Shown instead of "No matches." — so a picker that cannot create in place
   * can still say where to go, rather than leaving a dead end.
   */
  emptyMessage?: React.ReactNode
}

/**
 * Searchable select that can create a missing option in place.
 *
 * Reference data like brands and suppliers is discovered while entering
 * stock — being sent to another page to add "Patek Philippe" mid-form, and
 * losing everything typed so far, is the fastest way to make people avoid the
 * system. The value is mirrored into a hidden input so the surrounding form
 * still submits normally.
 */
export function ComboSelect({
  name, label, hint, error, required, className, placeholder = 'Choose…',
  options, value, onChange, onCreate, createLabel = 'Add', emptyMessage,
}: ComboSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [localOptions, setLocalOptions] = useState(options)
  const container = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => setLocalOptions(options), [options])

  useEffect(() => {
    if (!open) { setQuery(''); return }
    requestAnimationFrame(() => input.current?.focus())
    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const selected = localOptions.find((option) => option.value === value)
  const term = query.trim().toLowerCase()
  const filtered = term
    ? localOptions.filter((option) => option.label.toLowerCase().includes(term))
    : localOptions
  const exactMatch = localOptions.some((option) => option.label.toLowerCase() === term)
  const canCreate = Boolean(onCreate) && term.length > 0 && !exactMatch

  const create = async () => {
    if (!onCreate) return
    setCreating(true)
    const added = await onCreate(query.trim())
    setCreating(false)
    if (added) {
      setLocalOptions((current) => [...current, added].sort((a, b) => a.label.localeCompare(b.label)))
      onChange(added.value)
      setOpen(false)
    }
  }

  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <div ref={container} className="relative">
          <input type="hidden" name={name} value={value} />
          <button
            type="button"
            id={id}
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cn(
              'flex h-11 w-full items-center justify-between gap-2 rounded-md border bg-surface-raised px-3.5 text-left text-body transition-colors',
              invalid ? 'border-state-danger' : 'border-line-subtle hover:border-line-strong',
              selected ? 'text-content-primary' : 'text-content-secondary',
            )}
          >
            <span className="truncate">{selected?.label ?? placeholder}</span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-content-secondary transition-transform', open && 'rotate-180')} aria-hidden />
          </button>

          {open && (
            <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-line-subtle bg-surface-raised shadow-raised">
              <div className="flex items-center gap-2 border-b border-line-subtle px-3">
                <Search className="h-4 w-4 shrink-0 text-content-secondary" aria-hidden />
                <input
                  ref={input}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && canCreate) { event.preventDefault(); void create() } }}
                  placeholder={onCreate ? 'Search, or type to add new…' : 'Search…'}
                  aria-label="Search options"
                  className="w-full bg-transparent py-2.5 text-body text-content-primary outline-none placeholder:text-content-secondary"
                />
              </div>

              <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
                {filtered.map((option) => (
                  <li key={option.value} role="option" aria-selected={option.value === value}>
                    <button
                      type="button"
                      onClick={() => { onChange(option.value); setOpen(false) }}
                      className="flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-body text-content-primary hover:bg-surface-subtle"
                    >
                      <span className="truncate">{option.label}</span>
                      {option.value === value && <Check className="h-4 w-4 shrink-0 text-content-accent" aria-hidden />}
                    </button>
                  </li>
                ))}
                {filtered.length === 0 && !canCreate && (
                  <li className="px-3.5 py-3 text-small text-content-secondary">
                    {emptyMessage ?? (onCreate
                      ? 'Nothing here yet — type a name to add one.'
                      : 'No matches.')}
                  </li>
                )}
              </ul>

              {canCreate && (
                <button
                  type="button"
                  onClick={create}
                  disabled={creating}
                  className="flex w-full items-center gap-2 border-t border-line-subtle px-3.5 py-2.5 text-left text-body font-bold text-content-accent hover:bg-surface-subtle disabled:opacity-60"
                >
                  {creating
                    ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                    : <Plus className="h-4 w-4 shrink-0" aria-hidden />}
                  <span className="truncate">{createLabel} &ldquo;{query.trim()}&rdquo;</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Field>
  )
}
