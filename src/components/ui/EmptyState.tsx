import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  secondaryAction?: ReactNode
  className?: string
  /** `search` softens the copy for "no results" as opposed to "nothing yet". */
  variant?: 'default' | 'search' | 'error'
}

/**
 * Empty states carry the weight of first-run experience, so they always offer
 * the next action rather than just reporting absence.
 */
export function EmptyState({
  icon, title, description, action, secondaryAction, className, variant = 'default',
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}>
      {icon && (
        <div
          className={cn(
            'mb-4 flex h-14 w-14 items-center justify-center rounded-lg',
            variant === 'error' ? 'bg-state-danger/10 text-state-danger' : 'bg-surface-subtle text-content-secondary',
          )}
          aria-hidden
        >
          {icon}
        </div>
      )}
      <h3 className="text-h3 font-extrabold text-content-primary">{title}</h3>
      {description && (
        <p className="mt-2 max-w-md text-body text-content-secondary">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}
