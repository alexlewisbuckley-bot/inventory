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
        /*
         * A strip you swipe on a phone, a grid everywhere else.
         *
         * Stacked one to a row the six of them ran to 560 pixels, which put
         * the stock a full screen below the fold — Alex: "doesn't feel like
         * a web app feels likes a clunky old tool." Side by side they were
         * unreadable. Across, they are one card tall and every figure keeps
         * its size, because a card at 78% of the screen is 290 pixels and
         * "AED 28,727,500" wants 190.
         *
         * Bleeding to the edges, so the card at the end is visibly cut off
         * and the strip reads as something to push rather than as a card
         * that has been clipped.
         */
        'mb-6 -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2',
        '[&>*]:w-[78%] [&>*]:shrink-0 [&>*]:snap-start',
        'min-[520px]:mx-0 min-[520px]:mb-8 min-[520px]:grid min-[520px]:grid-cols-2',
        'min-[520px]:overflow-visible min-[520px]:px-0 min-[520px]:pb-0 sm:gap-6',
        'min-[520px]:[&>*]:w-auto min-[520px]:[&>*]:shrink',
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
        Down the card, at every width.

        Laid across for a moment — label left, figure right — while the
        cards were full width and stacked. In the strip that replaced that,
        a card is 290 pixels and the one at the edge is deliberately half
        visible: a right-aligned figure on it fell off the screen, so the
        card peeking in read "Retail value / 25 priced" with no number on
        it at all, which looks broken rather than cut off. Down the card,
        the half you can see is the half with the figure in it.
      */}
      <div>
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-caption font-semibold text-content-secondary">{label}</p>
          {icon && <span className="shrink-0 text-content-secondary" aria-hidden>{icon}</span>}
        </div>

        <p className={cn(
          'mt-2 text-h3 font-extrabold tabular-nums sm:text-h2',
          tone === 'accent' && 'text-content-accent',
          tone === 'danger' && 'text-state-danger',
          tone === 'default' && 'text-content-primary',
        )}>
          {value}
        </p>

        {caption && <p className="mt-1 text-caption text-content-secondary">{caption}</p>}
      </div>
    </div>
  )
}
