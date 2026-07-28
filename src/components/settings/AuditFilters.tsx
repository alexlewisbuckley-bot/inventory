'use client'
import { useListQuery } from '@/hooks/useListQuery'
import { X } from 'lucide-react'
import { Button, Pagination, ToolbarRow, ToolbarSelect } from '@/components/ui'
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS } from '@/lib/enums'

const ENTITY_TYPES = ['Watch', 'Sale', 'User', 'Supplier', 'Location', 'AppSetting'] as const

/** Filter controls for the audit trail. */
export function AuditFilters({ recordLabel }: { recordLabel?: string }) {
  const query = useListQuery()
  const entityId = query.get('entityId')

  return (
    <ToolbarRow className="mb-6">
      {/* Arriving from a record's "full history" link narrows the trail to one
          row of the database. Without saying so the page looks broken — a
          filtered list with nothing filtered on screen. */}
      {entityId && (
        <button
          type="button"
          onClick={() => query.set('entityId', null)}
          className="inline-flex h-11 items-center gap-2 rounded-md border border-teal-500 bg-teal-100 px-3.5 text-small font-bold text-content-accent transition-colors hover:bg-teal-100/70"
        >
          {recordLabel ?? 'One record'}
          <X className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">Show every record again</span>
        </button>
      )}
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
