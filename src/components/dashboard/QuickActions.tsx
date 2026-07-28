import type { ReactNode } from 'react'
import Link from 'next/link'

export interface QuickAction {
  href: string
  label: string
  hint: string
  icon: ReactNode
}

/**
 * The handful of things people come here to start.
 *
 * Kept to a single row of equal-weight targets: a dashboard that offers ten
 * shortcuts offers none. Each carries a hint so the label can stay short
 * without the destination being a guess.
 */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  if (actions.length === 0) return null
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {actions.map((action) => (
        <li key={action.href}>
          <Link
            href={action.href}
            className="flex h-full items-center gap-3 rounded-md border border-line-subtle bg-surface-raised px-4 py-3 transition-colors hover:border-line-strong hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-teal-500/12 text-content-accent" aria-hidden>
              {action.icon}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-small font-bold text-content-primary">{action.label}</span>
              <span className="block truncate text-caption text-content-secondary">{action.hint}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
