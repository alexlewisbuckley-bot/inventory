import { cn } from '@/lib/cn'

/**
 * The name, set in the brand's voice.
 *
 * Not the logo. The guidelines are explicit — the wordmark is supplied
 * artwork and is never retyped or redrawn — so this is the name typeset in
 * the house manner (uppercase, widely tracked, no weight shouting) and
 * clearly not a reproduction of the mark. Drop the supplied SVG in here and
 * it becomes the real thing without any call site moving.
 *
 * The tracking is the brand's own: the business cards run 0.2em on the name
 * and up to 0.34em on the line beneath it. It is the single most recognisable
 * thing about the identity after the colour, and it costs nothing to honour.
 */
export function Wordmark({ compact = false, className }: {
  /** Just "ONE STREET" — for a collapsed rail, where the third word will not fit. */
  compact?: boolean
  className?: string
}) {
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
