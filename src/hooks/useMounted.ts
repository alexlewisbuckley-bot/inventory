'use client'
import { useEffect, useState } from 'react'

/**
 * True only after hydration. Portals and any DOM-dependent render must wait for
 * this, otherwise the server and client markup disagree.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted
}
