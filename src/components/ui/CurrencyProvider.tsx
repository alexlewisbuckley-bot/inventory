'use client'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { formatBase, formatBaseSigned, fromBase, type RateTable } from '@/lib/currency'
import type { CurrencyCode } from '@/lib/enums'

interface CurrencyContextValue {
  currency: CurrencyCode
  rates: RateTable
  setCurrency: (currency: CurrencyCode) => void
  /** Format a GBP-base amount in the active display currency. */
  money: (baseMinor: number | null | undefined, options?: { decimals?: boolean; fallback?: string }) => string
  /** Signed variant, for profit figures. */
  signed: (baseMinor: number | null | undefined) => string
  /** Convert a GBP-base amount without formatting. */
  convert: (baseMinor: number) => number
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null)
const STORAGE_KEY = 'bluecroft.currency'

/**
 * Display currency for the whole application.
 *
 * Amounts are stored in GBP and converted at render time, so switching
 * currency never rewrites data — it only changes how the same underlying
 * figures are presented. The choice is mirrored to localStorage for instant
 * application on the next load and persisted server-side via preferences.
 */
export function CurrencyProvider({ children, initial, rates }: {
  children: ReactNode
  initial: CurrencyCode
  rates: RateTable
}) {
  const [currency, setCurrencyState] = useState<CurrencyCode>(initial)

  const setCurrency = useCallback((next: CurrencyCode) => {
    setCurrencyState(next)
    try { window.localStorage.setItem(STORAGE_KEY, next) } catch { /* private browsing */ }
  }, [])

  const value = useMemo<CurrencyContextValue>(() => ({
    currency,
    rates,
    setCurrency,
    money: (baseMinor, options) => formatBase(baseMinor, currency, rates, options),
    signed: (baseMinor) => formatBaseSigned(baseMinor, currency, rates),
    convert: (baseMinor) => fromBase(baseMinor, currency, rates),
  }), [currency, rates, setCurrency])

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

export function useCurrency(): CurrencyContextValue {
  const context = useContext(CurrencyContext)
  if (!context) throw new Error('useCurrency must be used inside <CurrencyProvider>.')
  return context
}
