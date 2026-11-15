/**
 * The portal's design kit: one place for the class strings every outside
 * page uses.
 *
 * They used to be pasted per file — the same input written eight ways, a
 * square button beside a round one — which is how pages built months apart
 * stopped looking like one product. Change a control here and every portal
 * page follows.
 *
 * Brand-coloured fills are applied with `brandFill` as an inline style,
 * because the colour is the partner's and only known at runtime.
 */

/** The partner's colours as the CSS variables every portal control reads. */
export function brandVars(brandColor?: string, accentColor?: string): React.CSSProperties {
  return {
    ...(brandColor ? { ['--brand' as string]: brandColor } : {}),
    ...(accentColor ? { ['--accent' as string]: accentColor } : {}),
  }
}

export const brandFill = { backgroundColor: 'var(--brand)', color: '#fff' } as const

export const ui = {
  /** Page width for list and detail pages. */
  page: 'mx-auto max-w-[1480px] px-5 py-8 sm:px-8',
  wide: 'mx-auto max-w-[1480px] px-5 sm:px-8',

  /** The small capitals over a title or a group. */
  eyebrow: 'text-[10.5px] font-semibold uppercase tracking-[0.2em] text-black/40',
  title: 'font-serif text-[28px] leading-tight text-black',
  heading: 'font-serif text-[20px] leading-snug text-black',
  muted: 'text-[13.5px] leading-relaxed text-black/55',

  label: 'text-[11px] font-semibold uppercase tracking-[0.14em] text-black/50',
  field:
    'mt-1.5 h-11 w-full rounded-[10px] border border-black/15 bg-white px-3.5 text-[14px] text-black outline-none transition ' +
    'placeholder:text-black/30 focus:border-black/50 focus:ring-4 focus:ring-black/[0.05]',
  textarea:
    'mt-1.5 w-full rounded-[10px] border border-black/15 bg-white px-3.5 py-2.5 text-[14px] text-black outline-none transition ' +
    'placeholder:text-black/30 focus:border-black/50 focus:ring-4 focus:ring-black/[0.05]',
  error: 'text-[12.5px] text-[#b42318]',

  /** Filled with the partner's colour: pair with style={brandFill}. */
  primary:
    'inline-flex h-11 items-center justify-center gap-2 rounded-full px-6 text-[12.5px] font-semibold uppercase ' +
    'tracking-[0.1em] text-white shadow-sm transition hover:opacity-90 active:scale-[0.99] disabled:opacity-60',
  outline:
    'inline-flex items-center justify-center gap-2 rounded-full border border-black/15 px-4 py-2 text-[12px] font-medium ' +
    'uppercase tracking-[0.1em] text-black/75 transition-colors hover:border-black hover:bg-black hover:text-white',
  ghost:
    'inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-medium uppercase tracking-[0.1em] ' +
    'text-black/45 transition-colors hover:bg-black/[0.04] hover:text-black/80',
  iconButton:
    'inline-flex h-9 w-9 items-center justify-center rounded-full text-black/40 transition-colors hover:bg-black/[0.05] hover:text-black',

  card: 'rounded-[14px] border border-black/10 bg-white',
  backdrop:
    'fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-5',
  dialog: 'max-h-full w-full overflow-y-auto rounded-t-[20px] bg-white p-6 shadow-2xl sm:rounded-[20px]',
} as const
