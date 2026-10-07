'use client'
import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'osw:inventory:trade-shots'

/**
 * Whether the stock gallery shows trade photographs instead of published ones.
 *
 * Remembered between visits, because the reason to turn it on is a job rather
 * than a glance: somebody works through the stock seeing which watches have
 * been shot for the trade and which still need doing, and that is not
 * finished in one sitting. Having to find the switch again every morning is
 * how a view stops being used.
 *
 * Kept out of the URL, unlike the table-or-gallery choice. That one changes
 * what a link shows somebody else; this one is a note to yourself about what
 * you are in the middle of, and putting it in the address bar would mean
 * sharing a link to the stock list sometimes sent the other photographs.
 *
 * Starts off, always, and only turns on after the first effect has read the
 * stored value — server and client must render the same thing or React
 * replaces the markup underneath the grid.
 */
export function useTradeShots(): { showTrade: boolean; setShowTrade: (on: boolean) => void } {
  const [showTrade, setStored] = useState(false)

  useEffect(() => {
    try {
      setStored(window.localStorage.getItem(STORAGE_KEY) === 'on')
    } catch { /* private browsing */ }
  }, [])

  const setShowTrade = useCallback((on: boolean) => {
    setStored(on)
    try {
      if (on) window.localStorage.setItem(STORAGE_KEY, 'on')
      else window.localStorage.removeItem(STORAGE_KEY)
    } catch { /* private browsing */ }
  }, [])

  return { showTrade, setShowTrade }
}
