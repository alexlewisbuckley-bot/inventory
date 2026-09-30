'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Lock, Pencil, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useToast } from '@/components/ui'

/**
 * A value that can be corrected where it is read, behind a lock.
 *
 * Two states rather than one, because the risks are not the same. An empty
 * field is an invitation: there is nothing to lose, so one click opens it.
 * A field that already holds a figure is closed, and opening it is its own
 * deliberate act — the point is not to stop the owner changing a cost, it is
 * to stop a cost changing because a row was clicked on the way somewhere
 * else. A stray click in a table of a hundred rows is silent, and the number
 * it lands on is one the business is valued on.
 *
 * The lock is therefore momentary: unlock, change, save, and it closes again.
 * Nothing stays open behind you.
 */
export function InlineEditCell({
  value, display, placeholder, kind = 'text', align = 'left',
  editable, onSave, className, label,
}: {
  /** The value as it should appear in the input when editing. */
  value: string
  /** The value as it is read when not editing. `null` means empty. */
  display: React.ReactNode
  /** What an empty cell offers instead of a value, e.g. "Set price". */
  placeholder: string
  kind?: 'text' | 'number' | 'money'
  align?: 'left' | 'right'
  editable: boolean
  /** Returns an error message, or null when the save succeeded. */
  onSave: (raw: string) => Promise<string | null>
  className?: string
  /** Names the field for assistive technology, e.g. "cost". */
  label: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    requestAnimationFrame(() => { input.current?.focus(); input.current?.select() })
  }, [editing])

  const open = () => { setDraft(value); setEditing(true) }
  const cancel = () => { setEditing(false); setDraft('') }

  const commit = async () => {
    // Nothing typed, nothing changed: closing is not a write.
    if (draft.trim() === value.trim()) { cancel(); return }
    setSaving(true)
    const error = await onSave(draft)
    setSaving(false)
    if (error) { toast.error(`Could not update the ${label}`, error); return }
    setEditing(false)
    toast.success('Saved')
    router.refresh()
  }

  if (!editable) return <span className={cn(kind !== 'text' && 'tabular-nums', className)}>{display ?? '—'}</span>

  if (editing) {
    return (
      <span
        className={cn(
          'relative inline-flex max-w-full items-center',
          align === 'right' ? 'justify-end' : 'justify-start',
        )}
      >
        {/* Holds the cell open at its resting size while the editor floats
            above it, so opening a field does not shunt the row about. */}
        <span className="invisible whitespace-nowrap" aria-hidden>{display ?? placeholder}</span>
        {/*
          The editor is taken out of the column and floated over the row.

          In the flow it was bounded by the column, and a money column is
          about ninety pixels wide: once the tick and the cross had taken
          their share there were twenty or so left for the number, so
          unlocking a cost produced a box too narrow to read what you were
          typing. A field being edited is the only thing on that row that
          matters for as long as it is open, so it is allowed the room.
        */}
        <span
          className={cn(
            'absolute top-1/2 z-20 flex w-[210px] -translate-y-1/2 items-center gap-1 rounded-sm',
            'border border-teal-500 bg-surface-raised px-1.5 py-1 shadow-raised',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
        <input
          ref={input}
          value={draft}
          inputMode={kind === 'text' ? undefined : 'decimal'}
          aria-label={`Edit ${label}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void commit() }
            if (e.key === 'Escape') { e.preventDefault(); cancel() }
          }}
          // Saving on blur would make a click elsewhere a write. Closing an
          // unlocked field without a decision has to mean "no change".
          onBlur={cancel}
          className={cn(
            'w-full min-w-0 bg-transparent text-small text-content-primary outline-none',
            kind !== 'text' && 'tabular-nums',
            align === 'right' && 'text-right',
          )}
        />
        {saving
          ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-content-secondary" aria-hidden />
          : (
            <>
              {/* onMouseDown, not onClick: the input's blur cancels first and
                  the click would never land. */}
              <button
                type="button" onMouseDown={(e) => { e.preventDefault(); void commit() }}
                aria-label={`Save ${label}`}
                className="shrink-0 rounded-sm p-0.5 text-content-accent hover:bg-teal-100"
              >
                <Check className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button" onMouseDown={(e) => { e.preventDefault(); cancel() }}
                aria-label={`Cancel editing ${label}`}
                className="shrink-0 rounded-sm p-0.5 text-content-secondary hover:bg-surface-subtle"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </>
          )}
        </span>
      </span>
    )
  }

  const empty = value.trim() === ''

  return (
    <button
      type="button"
      onClick={open}
      title={empty ? `Set the ${label}` : `Unlock the ${label} to change it`}
      aria-label={empty ? `Set the ${label}` : `Unlock the ${label} to change it. Currently locked.`}
      className={cn(
        // The padding is cancelled by the margin so the figure keeps the
        // column's own edge: an editable cell must not sit a few pixels off
        // the ones beside it.
        // The cap is the column's content box plus the padding the negative
        // margin gives back. `max-w-full` clamped the border box instead,
        // which quietly handed the 8px of hover chip to the browser and took
        // it out of the number — the column had room for "$155,000" and the
        // cell showed "$155,...".
        'group/cell relative -mx-1 inline-flex max-w-[calc(100%+0.5rem)] items-center gap-1 rounded-sm px-1 py-0.5 transition-colors hover:bg-surface-subtle',
        align === 'right' ? 'justify-end' : 'justify-start',
        kind !== 'text' && 'tabular-nums',
        className,
      )}
    >
      {empty
        ? (
          // An empty cell rests as the same quiet dash it always was, and
          // offers itself only when the pointer is on the row. Printing
          // "Add serial" down forty rows turns a column of missing values
          // into a column of instructions, and the table is read far more
          // often than it is filled in.
          <>
            <span className="text-content-muted group-hover:hidden">—</span>
            <span className="hidden whitespace-nowrap text-caption font-semibold text-content-secondary group-hover:inline">
              {placeholder}
            </span>
          </>
        )
        // A figure is never ellipsised. "$155,..." is not a shortened price,
        // it is a different number, and the column is sized to hold the
        // longest one rather than the value being cut to fit the column.
        // Only free text, where the full value is on the cell's title,
        // truncates.
        : <span className={cn(kind === 'text' ? 'truncate' : 'whitespace-nowrap')}>{display}</span>}
      {/* Out of the flow and in the cell's own padding, so a column of
          figures still lines up on its right edge whether or not this one
          happens to be under the pointer. */}
      <span
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/cell:opacity-60 group-focus-visible/cell:opacity-60',
          align === 'right' ? 'right-full mr-1' : 'left-full ml-1',
        )}
      >
        {empty
          ? <Pencil className="h-3 w-3" aria-hidden />
          : <Lock className="h-3 w-3" aria-hidden />}
      </span>
    </button>
  )
}
