'use client'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface PaginationProps {
  page: number
  perPage: number
  total: number
  onPage: (page: number) => void
  onPerPage?: (perPage: number) => void
  /** Singular noun for the summary line, e.g. "watch" -> "8 of 26 watches". */
  noun?: string
}

const PER_PAGE_OPTIONS = [25, 50, 100]

/**
 * Page controls with an elided page list (1 … 4 5 6 … 20) so the control keeps
 * a fixed footprint no matter how many pages exist.
 */
export function Pagination({ page, perPage, total, onPage, onPerPage, noun = 'result' }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / perPage))
  const from = total === 0 ? 0 : (page - 1) * perPage + 1
  const to = Math.min(page * perPage, total)
  const plural = total === 1 ? noun : `${noun}s`

  return (
    <div className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <p className="text-small text-content-secondary" aria-live="polite">
          {total === 0 ? `No ${plural}` : `Showing ${from}–${to} of ${total.toLocaleString()} ${plural}`}
        </p>
        {onPerPage && total > PER_PAGE_OPTIONS[0]! && (
          <label className="hidden items-center gap-2 text-small text-content-secondary sm:flex">
            <span className="sr-only">Results per page</span>
            <select
              value={perPage}
              onChange={(e) => onPerPage(Number(e.target.value))}
              className="h-8 cursor-pointer rounded-sm border border-line-subtle bg-surface-raised px-2 text-small text-content-primary transition-colors hover:border-line-strong"
            >
              {PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n} per page</option>)}
            </select>
          </label>
        )}
      </div>

      {pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center gap-1">
          <PageButton label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </PageButton>

          {elide(page, pages).map((item, index) =>
            item === '…' ? (
              <span key={`gap-${index}`} className="px-2 text-small text-content-secondary" aria-hidden>…</span>
            ) : (
              <PageButton
                key={item}
                label={`Page ${item}`}
                current={item === page}
                onClick={() => onPage(item)}
              >
                {item}
              </PageButton>
            ),
          )}

          <PageButton label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </PageButton>
        </nav>
      )}
    </div>
  )
}

function PageButton({ children, label, onClick, disabled, current }: {
  children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; current?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'inline-flex h-8 min-w-8 items-center justify-center rounded-sm px-2 text-small font-medium transition-colors',
        current ? 'bg-navy-700 font-bold text-white' : 'text-content-secondary hover:bg-surface-subtle',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      {children}
    </button>
  )
}

/** Windowed page numbers with ellipses. */
function elide(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const out: (number | '…')[] = [1]
  const start = Math.max(2, page - 1)
  const end = Math.min(pages - 1, page + 1)
  if (start > 2) out.push('…')
  for (let i = start; i <= end; i += 1) out.push(i)
  if (end < pages - 1) out.push('…')
  out.push(pages)
  return out
}
