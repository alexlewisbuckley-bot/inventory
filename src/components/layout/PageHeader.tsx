import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

export interface Crumb { label: string; href?: string }

/** Consistent page title block: breadcrumbs, title, description and actions. */
export function PageHeader({ title, description, actions, breadcrumbs }: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  breadcrumbs?: Crumb[]
}) {
  return (
    <div className="mb-8">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-3">
          <ol className="flex items-center gap-1.5 text-caption text-content-secondary">
            {breadcrumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
                {index > 0 && <ChevronRight className="h-3 w-3" aria-hidden />}
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-content-primary hover:underline">{crumb.label}</Link>
                ) : (
                  <span aria-current="page" className="text-content-primary">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-h1 font-extrabold text-content-primary">{title}</h1>
          {description && <p className="mt-1.5 text-body text-content-secondary">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </div>
  )
}
