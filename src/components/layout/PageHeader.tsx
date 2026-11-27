import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

export interface Crumb { label: string; href?: string }

/**
 * Consistent page title block: breadcrumbs, title, description and actions.
 *
 * Alex: "the entire mobile / iPhone duo experience is poor and lacks the
 * efficiency of a modern web app and feels more like a condensed desktop
 * tool."
 *
 * This block is on every screen, and on a phone it was the first 280 pixels
 * of all of them: a 36px title, a description under it and the actions below
 * that, with 32 pixels of air underneath. A desktop heading shrunk to fit is
 * exactly the complaint — so the heading steps down a size below sm and the
 * spacing closes up, while the wide screen keeps the title it had.
 */
export function PageHeader({ title, description, actions, breadcrumbs }: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  breadcrumbs?: Crumb[]
}) {
  return (
    <div className="mb-5 sm:mb-8">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 sm:mb-3">
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-h2 font-light text-content-primary sm:text-h1">{title}</h1>
          {description && <p className="mt-1 text-small text-content-secondary sm:mt-1.5 sm:text-body">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:gap-3">{actions}</div>}
      </div>
    </div>
  )
}
