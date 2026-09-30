'use client'
import { cn } from '@/lib/cn'
import { useBrandAssets } from './BrandProvider'

/**
 * The mark, with the name as its understudy.
 *
 * The guidelines are explicit — the wordmark is supplied artwork and is never
 * retyped or redrawn. So this renders the artwork when it is there and, until
 * it is, typesets the name in the house manner (uppercase, tracked at 0.2em,
 * the setting the business cards use), which is deliberately not a
 * reproduction of the mark.
 *
 * Which of the two is decided on the server, from the filesystem, and read
 * here out of context. Two earlier attempts were wrong in instructive ways.
 * An `onError` fallback cannot work at all: the image is server-rendered, so
 * a missing file fails during parse, before React has hydrated to attach the
 * handler, and the broken glyph stays on screen. Writing both out and hiding
 * one in CSS fixed the glyph but not the request — `display: none` does not
 * stop a browser fetching an `<img>`. Only one element is written now.
 *
 * The full lockup and the monogram are asked about separately, because they
 * arrive separately: having one and not the other is a supported state.
 *
 * `invert` in dark mode rather than a second file, which is why the artwork is
 * specified as one solid ink on transparent — see the README beside it.
 */
export function Wordmark({ compact = false, className }: {
  /** The collapsed rail: the monogram alone, or just "One Street" as text. */
  compact?: boolean
  className?: string
}) {
  const brand = useBrandAssets()

  if (compact ? brand.monogram : brand.wordmark) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={compact ? '/brand/monogram.svg' : '/brand/wordmark.svg'}
        alt="One Street Watches"
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
