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
export function StatCard({ label, value, caption, tone = 'default', icon }: {
  label: string
  value: ReactNode
  caption?: ReactNode
  tone?: 'default' | 'accent' | 'danger'
  icon?: ReactNode
}) {
  return (
    <div className="rounded-sm bg-surface-raised border border-line-subtle px-4 py-4 sm:px-6 sm:py-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-caption font-semibold text-content-secondary">{label}</p>
        {icon && <span className="text-content-secondary" aria-hidden>{icon}</span>}
      </div>
      {/*
        Smaller on a phone, because the box is smaller.

        Two of these to a 390-pixel row leaves each about 140 wide, and
        "AED 3,695,415" at 21px wants 175 — so the figure either ran off the
        card or, once it could wrap, broke after "AED" and left the currency
        stranded on a line of its own. Sixteen pixels fits it on one line,
        and it is still far and away the largest thing on the card next to a
        12px label. The full size returns as soon as there is room for it.

        Wrapping stays available underneath as the backstop: a longer figure
        in a narrower box should go onto two lines rather than be cut in half.
      */}
      <p className={cn(
        'mt-2 text-body-lg font-extrabold tabular-nums min-[480px]:text-h3 sm:text-h2',
        tone === 'accent' && 'text-content-accent',
        tone === 'danger' && 'text-state-danger',
        tone === 'default' && 'text-content-primary',
      )}>
        {value}
      </p>
      {caption && <p className="mt-1 text-caption text-content-secondary">{caption}</p>}
    </div>
  )
}
