'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Re-reads the page's data every few minutes, for a board left on a screen. */
export function AutoRefresh({ seconds = 300 }: { seconds?: number }) {
  const router = useRouter()
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), seconds * 1000)
    return () => clearInterval(timer)
  }, [router, seconds])
  return null
}
