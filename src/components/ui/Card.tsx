import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Card({ children, className, as: Tag = 'div' }: {
  children: ReactNode; className?: string; as?: 'div' | 'section' | 'article'
}) {
  return (
    <Tag className={cn('rounded-sm bg-surface-raised border border-line-subtle', className)}>
      {children}
    </Tag>
  )
}

export function CardHeader({ title, description, action, className }: {
  title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string
}) {
  return (
    // Stacked on a phone, side by side from 640px — the same lesson CardFooter
    // learned below, and this header never did. A row with a shrink-0 action
    // in it cannot give way: two buttons are wider than a phone on their own,
    // so the text beside them was squeezed to a column about one word across
    // and the buttons still ran off the edge of the card.
    <div className={cn(
      'flex flex-col gap-3 px-6 py-5 border-b border-line-subtle',
      'sm:flex-row sm:items-start sm:justify-between sm:gap-4',
      className,
    )}>
      {(title || description) && (
        <div className="min-w-0">
          {/* Wraps on a phone rather than truncating. A heading cut off at
              the edge of a 390px screen loses the half of it that says which
              card this is. */}
          {title && <h2 className="text-h3 font-extrabold text-content-primary sm:truncate">{title}</h2>}
          {description && <p className="mt-1 text-small text-content-secondary">{description}</p>}
        </div>
      )}
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-6 py-5', className)}>{children}</div>
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    // Wrapping matters on a narrow phone: a footer holding explanatory text and
    // a button is wider than 320px, and without it the whole page scrolls
    // sideways to reach a button nobody could see.
    <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-6 py-4 border-t border-line-subtle', className)}>
      {children}
    </div>
  )
}

/** Headline metric tile used across the dashboard and list headers. */
/**
 * The row of figures a page opens with.
 *
 * Alex, twice, from a phone: "Can't view pricing and product tiles properly
 * on mobile", then "Again can't view these figures very accurately,
 * presented off screen" — the second with AED 28,727,500 and AED 25,471,707
 * running off the edge of their cards.
 *
 * Two cards to a 390-pixel row leaves each about 140 wide inside its
 * padding. "+AED 26,326,430" wants about 190 at any size somebody would call
 * a headline figure, so on a phone it either overflowed, or — once it could
 * wrap — broke after the currency and left "+AED" stranded on a line of its
 * own. Shrinking it far enough to fit would have put the headline figure at
 * 15px against a 12px label, which is not a headline any more.
 *
 * So one to a row until there is room for two. The figures are then readable
 * at full size, which is the entire purpose of the card, and the extra
 * height costs a phone about one more flick of the thumb.
 *
 * A component rather than the class string it replaces, because that string
 * was copied onto four pages and the fifth would have been written without
 * the breakpoint. tests/mobile-money.test.ts fails the build if one is.
 */
export function StatGrid({ label, wide = false, children }: {
  label: string
  /** Four across on a large screen rather than three. */
  wide?: boolean
  children: ReactNode
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        'mb-8 grid gap-3 sm:gap-6 min-[520px]:grid-cols-2',
        wide ? 'xl:grid-cols-4' : 'xl:grid-cols-3',
      )}
    >
      {children}
    </section>
  )
}

export function StatCard({ label, value, caption, tone = 'default', icon }: {
  label: string
  value: ReactNode
  caption?: ReactNode
  tone?: 'default' | 'accent' | 'danger'
  icon?: ReactNode
}) {
  return (
    <div className="rounded-sm bg-surface-raised border border-line-subtle px-4 py-4 sm:px-6 sm:py-5">
      {/*
        Across on a phone, down on anything else.

        One card to a row gave the figure the width it needed and left most
        of that width empty beside it, with the page half as long again. Laid
        across — the label on the left, the figure on the right where the eye
        already goes for a number — the card is two lines instead of three
        and the figure keeps its full size.

        A grid rather than two layouts: the same three elements in the same
        order, placed differently. At 520 and above it is `block` and
        everything falls back into the column it has always been.
      */}
      <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 min-[520px]:block">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-caption font-semibold text-content-secondary">{label}</p>
          {icon && <span className="shrink-0 text-content-secondary" aria-hidden>{icon}</span>}
        </div>

        <p className={cn(
          'text-right text-h3 font-extrabold tabular-nums min-[520px]:mt-2 min-[520px]:text-left sm:text-h2',
          tone === 'accent' && 'text-content-accent',
          tone === 'danger' && 'text-state-danger',
          tone === 'default' && 'text-content-primary',
        )}>
          {value}
        </p>

        {caption && (
          <p className="col-span-2 mt-1 text-caption text-content-secondary">{caption}</p>
        )}
      </div>
    </div>
  )
}
