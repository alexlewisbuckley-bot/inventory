'use client'

import { useId } from 'react'
import { useCurrency } from './CurrencyProvider'
import { CURRENCIES, BASE_CURRENCY, type CurrencyCode } from '@/lib/enums'
import { formatBase, symbolFor, toBase } from '@/lib/currency'
import { formatMoneyInput, parseMoneyInput } from '@/lib/money'
import { cn } from '@/lib/cn'

/**
 * An amount plus the currency it was agreed in.
 *
 * Deals here are struck in four currencies, so forcing entry in one of them
 * made the operator do arithmetic before they could type — and any rounding
 * they did by hand was then stored as fact. The figure is captured exactly as
 * agreed and converted only for reporting, with the converted value shown live
 * underneath so there is no surprise about what will be recorded.
 */
export function MoneyField({
  label,
  amountName,
  currencyName,
  amount,
  currency,
  onAmountChange,
  onCurrencyChange,
  hint,
  error,
  required,
  autoFocus,
  disabled,
}: {
  label: string
  amountName?: string
  currencyName?: string
  amount: string
  currency: CurrencyCode
  onAmountChange: (value: string) => void
  onCurrencyChange: (value: CurrencyCode) => void
  hint?: string
  error?: string
  required?: boolean
  autoFocus?: boolean
  disabled?: boolean
}) {
  const id = useId()
  const { rates } = useCurrency()

  const minor = parseMoneyInput(amount)
  const equivalent = minor !== null && currency !== BASE_CURRENCY
    ? formatBase(toBase(minor, currency, rates), BASE_CURRENCY, rates)
    : null

  const describedBy = [error ? `${id}-error` : null, equivalent || hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ') || undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-caption font-semibold text-content-secondary">
        {label}
        {required && <span className="ml-0.5 text-state-danger" aria-hidden>*</span>}
      </label>

      <div
        className={cn(
          'focus-ring-none flex h-11 items-stretch overflow-hidden rounded-md border bg-surface-raised transition-colors',
          'focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/25',
          error ? 'border-state-danger' : 'border-line-subtle hover:border-line-strong',
          disabled && 'opacity-60',
        )}
      >
        {/* Only currencies with a real symbol get a prefix. AED and HKD have
            no glyph in common use, so `symbolFor` returns the code — printing
            it here would read "AED 55000  [AED]" beside the selector. */}
        {symbolFor(currency) !== currency && (
          <span className="flex select-none items-center pl-3.5 pr-1 text-body text-content-secondary" aria-hidden>
            {symbolFor(currency)}
          </span>
        )}
        <input
          id={id}
          name={amountName}
          value={amount}
          // Grouped as it is typed: 13105.51 read at a glance is one
          // mis-scan away from a ten-times pricing error.
          onChange={(event) => onAmountChange(formatMoneyInput(event.target.value))}
          inputMode="decimal"
          autoFocus={autoFocus}
          disabled={disabled}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'min-w-0 flex-1 bg-transparent pr-2 text-body tabular-nums text-content-primary outline-none placeholder:text-content-secondary',
            symbolFor(currency) === currency && 'pl-3.5',
          )}
          placeholder="0.00"
        />
        <select
          name={currencyName}
          value={currency}
          disabled={disabled}
          onChange={(event) => onCurrencyChange(event.target.value as CurrencyCode)}
          aria-label={`${label} currency`}
          className="border-l border-line-subtle bg-surface-subtle px-2.5 text-small font-semibold text-content-primary outline-none focus-visible:bg-surface-page"
        >
          {CURRENCIES.map((code) => (
            <option key={code} value={code}>{code}</option>
          ))}
        </select>
      </div>

      {error
        ? <p id={`${id}-error`} className="text-caption text-state-danger">{error}</p>
        : (equivalent || hint) && (
          <p id={`${id}-hint`} className="text-caption text-content-secondary">
            {equivalent ? `Recorded as ${equivalent}` : hint}
          </p>
        )}
    </div>
  )
}
