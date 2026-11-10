'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { useToast } from '@/components/ui'
import { amendWatchAction } from '@/app/actions/watches'
import { cn } from '@/lib/cn'
import type { ContentField } from '@/lib/validation'

export interface PickOption { value: string; label: string }

/**
 * A closed list, changed where it is read.
 *
 * Condition and box-and-papers are the two facts that are routinely unknown
 * when a watch is booked in and learned a minute later, with the piece in
 * hand. Reading "Not recorded" and having to open the full edit form to
 * answer it is how a record stays unanswered: the form has twenty fields
 * and a save button, and nobody opens it to set one word.
 *
 * So the value is the control. Same action the content grid uses, same
 * permission, same audit entry — this is a second door onto one behaviour,
 * not a second way of writing the field.
 *
 * Only for lists. A serial is typed and wants validation and a save you can
 * abandon; a supplier is a purchase fact, deliberately kept out of the
 * quick-edit path so a price-bearing relationship cannot be changed by a
 * stray keystroke.
 */
export function QuickPick({ watchId, field, label, value, options, canEdit }: {
  watchId: string
  field: Extract<ContentField, 'condition' | 'boxPapers'>
  /** Spoken name of the field, for the toast and the screen reader. */
  label: string
  value: string
  options: PickOption[]
  canEdit: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  // Held so the new answer is on screen while the server is still being
  // told. Without it the select snaps back to the old value for as long as
  // the round trip takes, which reads as the change having been refused.
  const [shown, setShown] = useState(value)

  const current = saving ? shown : value

  const commit = async (next: string) => {
    if (next === value) return
    setShown(next)
    setSaving(true)
    const result = await amendWatchAction({ field: 'content', id: watchId, key: field, value: next })
    setSaving(false)
    if (!result.ok) {
      setShown(value)
      toast.error(`Could not set the ${label.toLowerCase()}`, result.message ?? 'The change was rejected.')
      return
    }
    router.refresh()
  }

  const text = options.find((option) => option.value === current)?.label ?? current

  if (!canEdit) return <span className="text-small font-bold text-content-primary">{text}</span>

  return (
    // The chevron rides on the wrapper rather than inside the select,
    // because a select's own arrow cannot be moved and appearance-none
    // takes it away entirely — leaving nothing to say the value can be
    // changed, which on a panel of plain facts is the whole affordance.
    <span className="relative inline-flex items-center">
      <select
        value={current}
        disabled={saving}
        aria-label={label}
        onChange={(event) => void commit(event.target.value)}
        className={cn(
          'cursor-pointer appearance-none rounded border-0 bg-transparent py-0.5 pl-1.5 pr-5',
          'text-right text-small font-bold text-content-primary outline-none',
          'hover:bg-surface-subtle focus:ring-2 focus:ring-inset focus:ring-teal-500',
          saving && 'opacity-60',
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-1 h-3.5 w-3.5 text-content-muted"
        aria-hidden
      />
    </span>
  )
}
