import { RateLimitError } from '@/lib/errors'

interface Bucket { count: number; resetAt: number }

/**
 * Fixed-window rate limiter held in process memory.
 *
 * Adequate for a single-instance internal tool and keeps the deployment free of
 * Redis. If the app is ever scaled horizontally this module is the single place
 * to swap in a shared store — the call sites do not change.
 */
const buckets = new Map<string, Bucket>()

// Opportunistic sweep so the map cannot grow without bound.
let lastSweep = Date.now()
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
}

export interface RateLimitOptions {
  /** Unique bucket key, e.g. `login:alex@bluecroft.co.uk`. */
  key: string
  /** Requests permitted per window. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
}

/** Consume one token. Throws RateLimitError when the window is exhausted. */
export function rateLimit({ key, limit, windowMs }: RateLimitOptions): void {
  const now = Date.now()
  sweep(now)

  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return
  }

  bucket.count += 1
  if (bucket.count > limit) {
    throw new RateLimitError(Math.ceil((bucket.resetAt - now) / 1000))
  }
}

/** Clear a bucket after a successful action (e.g. a correct password). */
export function resetRateLimit(key: string): void {
  buckets.delete(key)
}

export const LIMITS = {
  login: { limit: 8, windowMs: 15 * 60_000 },
  mutation: { limit: 120, windowMs: 60_000 },
  import: { limit: 5, windowMs: 60_000 },
  export: { limit: 20, windowMs: 60_000 },
} as const
