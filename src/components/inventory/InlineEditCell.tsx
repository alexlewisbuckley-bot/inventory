'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Lock, Pencil } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useToast } from '@/components/ui'

/**
 * A cell you can edit where you read it.
 *
 * Built the way a data grid is built, because that is what this is and every
 * tool the reader already uses — a spreadsheet, Airtable, a CRM table —
 * behaves the same way:
 *
 *   • the cell itself becomes the field, filling the cell exactly, keeping
 *     the same type, alignment and position, so nothing moves when it opens;
 *   • Enter and Tab commit, clicking away commits, Escape abandons;
 *   • there are no buttons.
 *
 * The first attempt had a tick and a cross, and a money column is about a
 * hundred pixels wide: the buttons took most of it and left a box too narrow
 * to read what you were typing. Floating that panel over the row to make room
 * only moved the problem — it covered the columns either side and was clipped
 * by the cell it belonged to. The buttons were never the answer. A grid does
 * not need them, because the keyboard and the pointer already say plainly
 * enough when someone is finished.
 *
 * Committing on the way out rather than abandoning is the convention in all
 * of those tools, and the reason it is safe here is the lock: a value cannot
 * be opened by accident in the first place, so anything typed after opening
 * one deliberately is meant.
 */
export function InlineEditCell({
  value, display, placeholder, kind = 'text', align = 'left',
  editable, onSave, label,
}: {
  /** The value as it should appear in the field when editing. */
  value: string
  /** The value as it is read when not editing. */
  display: React.ReactNode
  /** What filling the cell is called, for the tooltip, e.g. "Set cost". */
  placeholder: string
  kind?: 'text' | 'number' | 'money'
  align?: 'left' | 'right'
  editable: boolean
  /** Returns an error message, or null when the save succeeded. */
  onSave: (raw: string) => Promise<string | null>
  /** Names the field for assistive technology, e.g. "cost". */
  label: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  // Enter commits and then the field loses focus, which would commit again.
  const settling = useRef(false)

  useEffect(() => {
    if (!editing) return
    requestAnimationFrame(() => { input.current?.focus(); input.current?.select() })
  }, [editing])

  const open = () => { setDraft(value); setEditing(true) }

  const close = () => { settling.current = false; setEditing(false); setDraft('') }

  const commit = async () => {
    if (settling.current) return
    settling.current = true
    // Opened and closed without touching it: that is not a write.
    if (draft.trim() === value.trim()) { close(); return }

    setSaving(true)
    const error = await onSave(draft)
    setSaving(false)

    if (error) {
      // Stay open with what they typed still there. Closing on a rejection
      // would throw the work away and leave the old value looking accepted.
      settling.current = false
      toast.error(`Could not update the ${label}`, error)
      requestAnimationFrame(() => input.current?.focus())
      return
    }
    close()
    router.refresh()
  }

  const alignment = align === 'right' ? 'justify-end text-right' : 'justify-start text-left'

  if (!editable) {
    return <span className={cn(kind !== 'text' && 'tabular-nums')}>{display}</span>
  }

  const empty = value.trim() === ''

  return (
    // Fills the cell, so the pointer target is the cell and the field that
    // replaces it lands in exactly the same place.
    <span className="absolute inset-0 block">
      {editing ? (
        <>
          <input
            ref={input}
            value={draft}
            inputMode={kind === 'text' ? undefined : 'decimal'}
            aria-label={`${label} — press Enter to save, Escape to cancel`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void commit() }
              // Tab commits and moves on, as it does in a spreadsheet.
              else if (e.key === 'Tab') void commit()
              else if (e.key === 'Escape') { e.preventDefault(); close() }
            }}
            onBlur={() => { void commit() }}
            className={cn(
              // Inset by a pixel so the ring sits inside the cell rather than
              // on the row's own rule.
              'absolute inset-px z-20 w-[calc(100%-2px)] rounded-sm bg-surface-raised text-small text-content-primary',
              'px-4 outline-none ring-2 ring-inset ring-teal-500',
              align === 'right' && 'text-right',
              kind !== 'text' && 'tabular-nums',
            )}
          />
          {saving && (
            <Loader2
              className={cn(
                'pointer-events-none absolute top-1/2 z-30 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-content-secondary',
                align === 'right' ? 'left-1.5' : 'right-1.5',
              )}
              aria-hidden
            />
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={open}
          title={empty ? placeholder : `Unlock the ${label} to change it`}
          aria-label={empty
            ? `Set the ${label}`
            : `Unlock the ${label} to change it. Currently locked.`}
          className={cn(
            'flex h-full w-full items-center gap-1.5 px-4 text-inherit transition-colors hover:bg-surface-subtle',
            alignment,
            kind !== 'text' && 'tabular-nums',
          )}
        >
          {/* The mark travels with the value rather than sitting at the far
              edge of the column. Anchored to the cell it read as belonging to
              the column next door — a lock at the left edge of the trade
              column looks like it is guarding the cost beside it. It stays
              out of the flow, so a column of figures keeps its edge whether
              or not this row happens to be under the pointer. */}
          <span className={cn('relative flex min-w-0 items-center', align === 'right' ? 'justify-end' : 'justify-start')}>
            {empty
              ? (
                // An empty cell stays the quiet dash it always was, and says
                // what it offers through the mark beside it and the tooltip,
                // not in words. "Add serial" printed down forty rows turns a
                // column of missing values into a column of instructions, and
                // in a 72px year column it did not even fit — the label ran
                // over its own pencil. A dash fits every column there is.
                <span className="text-content-muted">—</span>
              )
              // A figure is never ellipsised: "$155,..." is not a shortened
              // price, it is a different number. The column is sized to hold
              // the longest one instead. Only free text truncates, and it
              // carries its full value on the cell.
              : <span className={cn('min-w-0', kind === 'text' ? 'truncate' : 'whitespace-nowrap')}>{display}</span>}
            <span
              className={cn(
                'pointer-events-none absolute top-1/2 -translate-y-1/2 text-content-muted opacity-0 transition-opacity',
                'group-hover:opacity-70 group-focus-within:opacity-70',
                align === 'right' ? 'right-full mr-1.5' : 'left-full ml-1.5',
              )}
            >
              {empty ? <Pencil className="h-3 w-3" aria-hidden /> : <Lock className="h-3 w-3" aria-hidden />}
            </span>
          </span>
        </button>
      )}
    </span>
  )
}
