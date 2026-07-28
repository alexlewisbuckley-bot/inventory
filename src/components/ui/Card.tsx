import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Card({ children, className, as: Tag = 'div' }: {
  children: ReactNode; className?: string; as?: 'div' | 'section' | 'article'
}) {
  return (
    <Tag className={cn('rounded-lg bg-surface-raised border border-line-subtle shadow-card', className)}>
      {children}
    </Tag>
  )
}

export function CardHeader({ title, description, action, className }: {
  title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-6 py-5 border-b border-line-subtle', className)}>
      <div className="min-w-0">
        <h2 className="text-h3 font-extrabold text-content-primary truncate">{title}</h2>
        {description && <p className="mt-1 text-small text-content-secondary">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-6 py-5', className)}>{children}</div>
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-4 px-6 py-4 border-t border-line-subtle', className)}>
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
    <div className="rounded-lg bg-surface-raised border border-line-subtle shadow-card px-6 py-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-micro font-semibold uppercase tracking-wide text-content-secondary">{label}</p>
        {icon && <span className="text-content-secondary" aria-hidden>{icon}</span>}
      </div>
      <p className={cn(
        'mt-2 text-h2 font-extrabold tabular-nums',
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
