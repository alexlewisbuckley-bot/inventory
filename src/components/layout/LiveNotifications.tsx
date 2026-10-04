'use client'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui'

interface Live {
  id: string
  type: string
  title: string
  body: string | null
  entityType: string | null
  entityId: string | null
}

const UnreadContext = createContext<number | null>(null)

/**
 * The count the bell actually shows.
 *
 * The server's number is the seed and the poller replaces it, so the badge is
 * right on first paint and stays right afterwards without the page being
 * reloaded.
 */
export function useUnread(fallback: number): number {
  const live = useContext(UnreadContext)
  return live ?? fallback
}

/** How often to ask, awake and asleep. */
const AWAKE_MS = 20_000
const HIDDEN_MS = 120_000

/** Where a notification points, when it points anywhere. */
function hrefFor(item: Live): string | null {
  if (!item.entityId) return null
  switch (item.entityType) {
    case 'TradeEnquiry': return `/enquiries/${item.entityId}`
    case 'Watch': return `/inventory/${item.entityId}`
    case 'Deal': return `/deals/${item.entityId}`
    case 'Customer': return `/customers/${item.entityId}`
    default: return '/notifications'
  }
}

/**
 * Notifications that arrive while you are looking at something else.
 *
 * The bell was rendered with the page, so a trade partner enquiring at four
 * o'clock reached an owner who had been on the inventory list since two only
 * when they next navigated. The count is now polled, the badge follows it, and
 * anything new raises a toast that goes where the notification points.
 *
 * Polling rather than a stream, deliberately: the platform closes a serverless
 * function after sixty seconds, so a stream here is a reconnect loop wearing a
 * stream's clothes. Twenty seconds awake, two minutes when the tab is hidden,
 * and an immediate ask whenever it comes back to the front — which is what
 * makes returning to the tab feel instant rather than up-to-twenty-seconds.
 *
 * It also refreshes the current route when something lands, so an enquiry
 * thread somebody is reading grows a reply without being told to reload.
 */
export function LiveNotifications({ initialUnread, children }: {
  initialUnread: number
  children: React.ReactNode
}) {
  const router = useRouter()
  const toast = useToast()
  const [unread, setUnread] = useState(initialUnread)
  // What was already on screen when this mounted. Without it, every reload
  // would announce the newest notification again.
  const seen = useRef<string | null>(null)
  const started = useRef(false)

  const poll = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications/live', { cache: 'no-store' })
      if (!response.ok) return
      const data = await response.json() as { unread: number; latest: Live | null }
      setUnread(data.unread)

      if (!data.latest) return
      if (!started.current) {
        // The first answer only establishes where we are.
        started.current = true
        seen.current = data.latest.id
        return
      }
      if (data.latest.id === seen.current) return
      seen.current = data.latest.id

      const href = hrefFor(data.latest)
      toast.toast({
        tone: 'info',
        title: data.latest.title,
        description: data.latest.body ?? undefined,
        // Longer than a normal toast: this is the one somebody did not ask
        // for, so it has to survive not being looked at immediately.
        duration: 12_000,
        action: href ? { label: 'Open', onClick: () => router.push(href) } : undefined,
      })
      // Whatever is on screen may be the thing that changed.
      router.refresh()
    } catch {
      // A failed poll is a poll; the next one is twenty seconds away.
    }
  }, [router, toast])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let stopped = false

    const tick = async () => {
      if (stopped) return
      if (document.visibilityState === 'visible') await poll()
      if (stopped) return
      timer = setTimeout(tick, document.visibilityState === 'visible' ? AWAKE_MS : HIDDEN_MS)
    }
    void tick()

    // Coming back to the tab is the moment somebody expects to be up to date.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      clearTimeout(timer)
      void tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [poll])

  return <UnreadContext.Provider value={unread}>{children}</UnreadContext.Provider>
}
