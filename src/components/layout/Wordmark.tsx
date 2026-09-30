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
 * The supplied lockup is stacked — ONE STREET over WATCHES, 620×130 — so it
 * is set at 34×162, which fits the 232px rail with its 20px gutters. At the
 * 18px the typeset name wanted, the second line would have been four pixels
 * tall. The monogram is the interlocking OS, 216×250 and so taller than it is
 * wide, set at 32×28 for the 68px collapsed rail. Both dimensions are stated
 * in each case; see the note on the class list.
 */
export function Wordmark({ compact = false, onInverse = false, className }: {
  /** The collapsed rail: the monogram alone, or just "One Street" as text. */
  compact?: boolean
  /**
   * The mark is sitting on the inverse ground — the Obsidian panel on the
   * sign-in screen. That ground flips with the theme (Ink in light, Ivory in
   * dark), so the artwork has to flip the opposite way to the usual rule, and
   * the typeset name takes the inverse ink.
   */
  onInverse?: boolean
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
          'object-contain object-left',
          // One ink on transparent, so the dark theme is a filter rather than
          // a second file — see the README beside the artwork.
          onInverse ? 'invert dark:invert-0' : 'dark:invert',
          // Both dimensions, not `w-auto`. An image with `width: auto` in a
          // column flex is stretched by `align-items: stretch` before the
          // intrinsic ratio ever gets a say: on the sign-in panel the 620×130
          // lockup came out 624×34, a letterboxed sliver in a box five times
          // too wide. 162 is 34 at the artwork's own ratio.
          compact ? 'h-8 w-[28px]' : 'h-[34px] w-[162px]',
          className,
        )}
      />
    )
  }

  return (
    <span
      className={cn(
        'select-none whitespace-nowrap font-semibold uppercase leading-none',
        onInverse ? 'text-content-inverse' : 'text-content-primary',
        compact ? 'text-[11px] tracking-[0.18em]' : 'text-[13px] tracking-[0.2em]',
        className,
      )}
    >
      {compact ? 'One Street' : 'One Street Watches'}
    </span>
  )
}
