'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useCurrency } from '@/components/ui/CurrencyProvider'
import { updateDisplayCurrencyAction } from '@/app/actions/admin'
import { CURRENCIES, CURRENCY_LABELS, type CurrencyCode } from '@/lib/enums'
import { describeRate } from '@/lib/currency'

/**
 * Display-currency picker in the header.
 *
 * Switching is instant — conversion happens at render — and the choice is
 * saved to the user's preferences in the background so it follows them to
 * another device.
 */
export function CurrencySwitcher() {
  const router = useRouter()
  const { currency, setCurrency, rates } = useCurrency()
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

  const choose = (next: CurrencyCode) => {
    setCurrency(next)
    setOpen(false)
    // Client-rendered figures switch instantly via context. Server-rendered
    // pages read the stored preference, so refresh once it is saved.
    void updateDisplayCurrencyAction(next).then(() => router.refresh())
  }

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Display currency: ${currency}. Change`}
        className="flex items-center gap-1.5 rounded-md border border-line-subtle px-2.5 py-2 text-small font-bold text-content-primary transition-colors hover:border-line-strong"
      >
        {currency}
        <ChevronDown className={cn('h-3.5 w-3.5 text-content-secondary transition-transform', open && 'rotate-180')} aria-hidden />
      </button>

      {open && (
        <div role="listbox" className="absolute right-0 z-40 mt-1 w-60 overflow-hidden rounded-md border border-line-subtle bg-surface-raised shadow-raised">
          <p className="border-b border-line-subtle px-4 py-2.5 text-caption text-content-secondary">
            Amounts are stored in GBP and converted for display.
          </p>
          <ul className="py-1">
            {CURRENCIES.map((code) => (
              <li key={code} role="option" aria-selected={code === currency}>
                <button
                  type="button"
                  onClick={() => choose(code)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-subtle"
                >
                  <span className="w-10 shrink-0 text-body font-bold text-content-primary">{code}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-caption text-content-secondary">{CURRENCY_LABELS[code]}</span>
                    <span className="block truncate text-micro text-content-secondary">{describeRate(code, rates)}</span>
                  </span>
                  {code === currency && <Check className="h-4 w-4 shrink-0 text-content-accent" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
          <a
            href="/settings/currencies"
            className="block border-t border-line-subtle px-4 py-2.5 text-caption font-bold text-content-accent hover:bg-surface-subtle"
          >
            Update exchange rates →
          </a>
        </div>
      )}
    </div>
  )
}
