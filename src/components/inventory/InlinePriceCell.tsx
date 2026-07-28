'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useToast, useCurrency } from '@/components/ui'
import { setPriceAction } from '@/app/actions/watches'
import { formatMoneyInput, parseMoneyInput } from '@/lib/money'
import { toBase } from '@/lib/currency'

/**
 * Editable estimated sale price.
 *
 * Setting a price was the single most repeated task in the product and cost
 * six interactions: find the row, open the drawer, click edit, wait for a
 * form, change one number, save. It is now click, type, Enter — in the cell
 * the user is already looking at.
 *
 * The value is entered in whatever currency is on display and converted to the
 * GBP base on save, so someone working in AED never has to convert by hand.
 */
export function InlinePriceCell({ watchId, baseMinor, editable }: {
  watchId: string
  baseMinor: number | null
  editable: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const { money, currency, rates, convert } = useCurrency()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    requestAnimationFrame(() => { input.current?.focus(); input.current?.select() })
  }, [editing])

  const begin = () => {
    setValue(baseMinor !== null ? formatMoneyInput(String(convert(baseMinor) / 100)) : '')
    setEditing(true)
  }

  const cancel = () => { setEditing(false); setValue('') }

  const save = async () => {
    const entered = parseMoneyInput(value)
    if (entered === null) { cancel(); return }
    // The amount goes to the server in the currency it was typed in; the
    // service does the single conversion to the reporting base.
    setSaving(true)
    const result = await setPriceAction(watchId, entered / 100, currency)
    setSaving(false)
    setEditing(false)

    if (result.ok) {
      toast.success('Price updated')
      router.refresh()
    } else {
      toast.error('Could not update the price', result.message)
    }
  }

  if (!editable) {
    return <span className="tabular-nums">{money(baseMinor)}</span>
  }

  if (editing) {
    return (
      <span className="flex items-center justify-end gap-1">
        <input
          ref={input}
          value={value}
          inputMode="decimal"
          aria-label="Estimated sale price"
          onChange={(event) => setValue(formatMoneyInput(event.target.value))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); void save() }
            if (event.key === 'Escape') { event.preventDefault(); cancel() }
          }}
          onBlur={() => { if (!saving) void save() }}
          className="w-24 rounded-sm border border-teal-500 bg-surface-raised px-1.5 py-1 text-right text-small tabular-nums text-content-primary outline-none"
        />
        {saving
          ? <Loader2 className="h-3.5 w-3.5 animate-spin text-content-secondary" aria-hidden />
          : (
            <>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void save()}
                aria-label="Save price" className="rounded-sm p-0.5 text-content-accent hover:bg-teal-100">
                <Check className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={cancel}
                aria-label="Cancel" className="rounded-sm p-0.5 text-content-secondary hover:bg-surface-subtle">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </>
          )}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={begin}
      // The visible text is a number, so on its own the accessible name is
      // "£14,980" — which says nothing about what pressing it does.
      aria-label={baseMinor === null
        ? 'Set the estimated sale price'
        : `Estimated sale price ${money(baseMinor)}. Edit it.`}
      title="Click to set the estimated sale price"
      className={cn(
        'group/price inline-flex items-center justify-end gap-1.5 rounded-sm px-1 py-0.5 tabular-nums transition-colors hover:bg-surface-subtle',
        baseMinor === null && 'text-content-secondary',
      )}
    >
      {baseMinor === null ? <span className="text-caption font-semibold">Set price</span> : money(baseMinor)}
      <Pencil className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/price:opacity-60" aria-hidden />
    </button>
  )
}
