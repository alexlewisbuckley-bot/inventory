'use client'

import { useEffect, useState } from 'react'
import { relativeTime, formatDateTime } from '@/lib/dates'

/**
 * A relative timestamp that survives hydration and does not go stale.
 *
 * "58 seconds ago" rendered on the server is "1 minute ago" by the time the
 * browser hydrates. React treats that difference as a corrupted tree, discards
 * the server HTML for the whole boundary and re-renders it on the client — a
 * real error, thrown on the users page every time somebody had signed in
 * recently, and invisible in a screenshot because the recovery looks fine.
 *
 * The server's value is still rendered, so the page reads correctly without
 * JavaScript; it is recomputed on mount and then ticked, so a dashboard left
 * open overnight does not still claim everything happened a minute ago. The
 * exact timestamp stays available in the tooltip.
 */
export function RelativeTime({ value, fallback = '—', className }: {
  value: string | Date | null | undefined
  fallback?: string
  className?: string
}) {
  const [label, setLabel] = useState(() => relativeTime(value, fallback))

  useEffect(() => {
    const update = () => setLabel(relativeTime(value, fallback))
    update()
    const timer = setInterval(update, 30_000)
    return () => clearInterval(timer)
  }, [value, fallback])

  if (!value) return <span className={className}>{fallback}</span>

  const iso = typeof value === 'string' ? value : value.toISOString()
  return (
    <time dateTime={iso} title={formatDateTime(value)} className={className} suppressHydrationWarning>
      {label}
    </time>
  )
}
