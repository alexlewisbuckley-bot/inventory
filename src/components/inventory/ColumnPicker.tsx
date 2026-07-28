'use client'
import { useEffect, useRef, useState } from 'react'
import { Columns3, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface ColumnDefinition {
  key: string
  label: string
  /** Columns without which a row is unidentifiable cannot be hidden. */
  locked?: boolean
}

/**
 * Column visibility menu.
 *
 * The inventory table carries a lot of columns because different people need
 * different ones — a buyer wants cost and margin, someone on the shop floor
 * wants location and status. Rather than choosing for them, each person hides
 * what they do not use.
 */
export function ColumnPicker({ columns, isHidden, onToggle, onReset, hiddenCount }: {
  columns: readonly ColumnDefinition[]
  isHidden: (key: string) => boolean
  onToggle: (key: string) => void
  onReset: () => void
  hiddenCount: number
}) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
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

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'flex h-11 items-center gap-2 rounded-md border bg-surface-raised px-3.5 text-small font-semibold transition-colors',
          hiddenCount > 0
            ? 'border-teal-500 text-content-primary'
            : 'border-line-subtle text-content-secondary hover:border-line-strong',
        )}
      >
        <Columns3 className="h-4 w-4" aria-hidden />
        Columns
        {hiddenCount > 0 && (
          <span className="rounded-pill bg-teal-500 px-1.5 text-micro font-bold text-navy-900">
            {hiddenCount} hidden
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-md border border-line-subtle bg-surface-raised shadow-raised"
        >
          <p className="border-b border-line-subtle px-4 py-2.5 text-caption text-content-secondary">
            Choose what to show. Saved on this device.
          </p>
          <ul className="max-h-72 overflow-y-auto py-1">
            {columns.map((column) => {
              const visible = !isHidden(column.key)
              return (
                <li key={column.key}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-3 px-4 py-2 text-body hover:bg-surface-subtle',
                      column.locked && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={visible}
                      disabled={column.locked}
                      onChange={() => onToggle(column.key)}
                      className="h-4 w-4 rounded-xs accent-teal-500"
                    />
                    <span className="truncate text-content-primary">{column.label}</span>
                    {column.locked && <span className="ml-auto text-micro text-content-secondary">always</span>}
                  </label>
                </li>
              )
            })}
          </ul>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => { onReset(); setOpen(false) }}
              className="flex w-full items-center gap-2 border-t border-line-subtle px-4 py-2.5 text-left text-small font-bold text-content-accent hover:bg-surface-subtle"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Show all columns
            </button>
          )}
        </div>
      )}
    </div>
  )
}
