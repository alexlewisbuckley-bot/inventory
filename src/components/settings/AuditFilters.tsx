'use client'
import { useListQuery } from '@/hooks/useListQuery'
import { Button, Pagination, ToolbarRow, ToolbarSelect } from '@/components/ui'
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS } from '@/lib/enums'

const ENTITY_TYPES = ['Watch', 'Sale', 'User', 'Supplier', 'Location', 'AppSetting'] as const

/** Filter controls for the audit trail. */
export function AuditFilters() {
  const query = useListQuery()

  return (
    <ToolbarRow className="mb-6">
      <ToolbarSelect
        label="Entity"
        value={query.get('entityType') ?? ''}
        onChange={(value) => query.set('entityType', value || null)}
        options={ENTITY_TYPES.map((type) => ({ value: type, label: type }))}
      />
      <ToolbarSelect
        label="Action"
        value={query.get('action') ?? ''}
        onChange={(value) => query.set('action', value || null)}
        options={AUDIT_ACTIONS.map((action) => ({ value: action, label: AUDIT_ACTION_LABELS[action] }))}
      />
      {query.activeFilterCount > 0 && (
        <Button variant="ghost" size="sm" onClick={query.clearAll}>Clear filters</Button>
      )}
    </ToolbarRow>
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
