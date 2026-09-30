'use client'
import { useState } from 'react'
import { cn } from '@/lib/cn'

/**
 * The mark, with the name as its understudy.
 *
 * The guidelines are explicit — the wordmark is supplied artwork and is never
 * retyped or redrawn. So this renders the artwork when it is there, and until
 * it is, typesets the name in the house manner (uppercase, tracked at 0.2em,
 * the setting the business cards use) which is deliberately not a
 * reproduction of the mark.
 *
 * The swap is an `onError`, not a build flag: drop `wordmark.svg` into
 * `public/brand/` and the mark appears on the next request with nothing to
 * rebuild and no call site to change. A missing file shows the name rather
 * than a broken image.
 *
 * `invert` in dark mode rather than a second file, which is why the artwork
 * is specified as one solid ink on transparent — see the README beside it.
 */
export function Wordmark({ compact = false, className }: {
  /** The collapsed rail: the monogram alone, or just "One Street" as text. */
  compact?: boolean
  className?: string
}) {
  const [missing, setMissing] = useState(false)
  const src = compact ? '/brand/monogram.svg' : '/brand/wordmark.svg'

  if (!missing) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={src}
        alt="One Street Watches"
        onError={() => setMissing(true)}
        className={cn(
          'w-auto object-contain object-left dark:invert',
          compact ? 'h-7' : 'h-[18px]',
          className,
        )}
      />
    )
  }

  return (
    <span
      className={cn(
        'select-none whitespace-nowrap font-semibold uppercase leading-none text-content-primary',
        compact ? 'text-[11px] tracking-[0.18em]' : 'text-[13px] tracking-[0.2em]',
        className,
      )}
    >
      {compact ? 'One Street' : 'One Street Watches'}
    </span>
  )
}
