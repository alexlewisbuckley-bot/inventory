'use client'
import { useListQuery } from '@/hooks/useListQuery'
import { Button, Pagination } from '@/components/ui'
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS } from '@/lib/enums'

const ENTITY_TYPES = ['Watch', 'Sale', 'User', 'Supplier', 'Location', 'AppSetting'] as const

/** Filter controls for the audit trail. */
export function AuditFilters() {
  const query = useListQuery()

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2">
        <span className="text-caption font-semibold text-content-secondary">Entity</span>
        <select
          value={query.get('entityType') ?? ''}
          onChange={(e) => query.set('entityType', e.target.value || null)}
          className="rounded-md border border-line-subtle bg-surface-raised px-3 py-2.5 text-small"
        >
          <option value="">All</option>
          {ENTITY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
      </label>

      <label className="flex items-center gap-2">
        <span className="text-caption font-semibold text-content-secondary">Action</span>
        <select
          value={query.get('action') ?? ''}
          onChange={(e) => query.set('action', e.target.value || null)}
          className="rounded-md border border-line-subtle bg-surface-raised px-3 py-2.5 text-small"
        >
          <option value="">All</option>
          {AUDIT_ACTIONS.map((action) => (
            <option key={action} value={action}>{AUDIT_ACTION_LABELS[action]}</option>
          ))}
        </select>
      </label>

      {query.activeFilterCount > 0 && (
        <Button variant="ghost" size="sm" onClick={query.clearAll}>Clear filters</Button>
      )}
    </div>
  )
}

export function AuditPaginationClient({ page, total }: { page: number; total: number }) {
  const query = useListQuery()
  return (
    <Pagination
      page={page}
      perPage={50}
      total={total}
      noun="entry"
      onPage={(next) => query.set('page', String(next))}
    />
  )
}
