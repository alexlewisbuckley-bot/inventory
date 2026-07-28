import type { Metadata } from 'next'
import Link from 'next/link'
import { requireCapability } from '@/server/auth/session'
import { auditTrail } from '@/server/services/audit'
import { Card, Table, THead, TBody, TR, TD, TH, Chip, Avatar, EmptyState } from '@/components/ui'
import { AuditFilters, AuditPaginationClient } from '@/components/settings/AuditFilters'
import { formatDateTime } from '@/lib/dates'
import { AUDIT_ACTION_LABELS, AUDIT_ACTIONS, type AuditAction } from '@/lib/enums'
import { changeValue, fieldLabel } from '@/lib/audit-format'
import { History } from 'lucide-react'

export const metadata: Metadata = { title: 'Audit trail' }
export const dynamic = 'force-dynamic'

const TONES: Partial<Record<AuditAction, 'accent' | 'gold' | 'danger' | 'neutral'>> = {
  CREATE: 'accent', SELL: 'accent', DELETE: 'danger', PASSWORD_CHANGE: 'gold', MOVE: 'gold',
}

export default async function AuditPage({ searchParams }: {
  searchParams: { page?: string; entityType?: string; entityId?: string; action?: string }
}) {
  await requireCapability('audit:read')

  const page = Number(searchParams.page ?? 1)
  const action = AUDIT_ACTIONS.includes(searchParams.action as AuditAction)
    ? (searchParams.action as AuditAction)
    : undefined

  const { entries, total } = await auditTrail({
    page,
    perPage: 50,
    entityType: searchParams.entityType || undefined,
    entityId: searchParams.entityId || undefined,
    action,
  })

  return (
    <>
      <AuditFilters
        recordLabel={searchParams.entityId
          ? `Only this ${(entries[0]?.entityType ?? 'record').toLowerCase()}`
          : undefined}
      />

      <Card className="overflow-hidden">
        {entries.length === 0 ? (
          <EmptyState
            icon={<History className="h-6 w-6" />}
            title="No matching activity"
            description="Every change to stock, sales, users and settings is recorded here. Try widening the filters."
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH width="170px">When</TH>
                  <TH width="150px">Who</TH>
                  <TH width="130px">Action</TH>
                  <TH>What changed</TH>
                  <TH width="110px">Entity</TH>
                </TR>
              </THead>
              <TBody>
                {entries.map((entry) => (
                  <TR key={entry.id}>
                    <TD className="text-content-secondary">{formatDateTime(entry.createdAt)}</TD>
                    <TD>
                      {entry.actor ? (
                        <span className="flex items-center gap-2">
                          <Avatar initials={entry.actor.initials} id={entry.actor.id} size="sm" />
                          <span className="truncate">{entry.actor.name}</span>
                        </span>
                      ) : (
                        <span className="text-content-secondary">System</span>
                      )}
                    </TD>
                    <TD>
                      <Chip tone={TONES[entry.action] ?? 'neutral'}>{AUDIT_ACTION_LABELS[entry.action]}</Chip>
                    </TD>
                    <TD>
                      <p className="text-content-primary">{entry.summary ?? '—'}</p>
                      {entry.changes && (
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {Object.entries(entry.changes).slice(0, 3).map(([field, change]) => (
                            <li key={field} className="text-caption text-content-secondary">
                              <span className="font-semibold">{fieldLabel(field)}</span>:{' '}
                              {changeValue(change.from)} → {changeValue(change.to)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TD>
                    <TD>
                      {entry.entityType === 'Watch' && entry.entityId !== 'bulk' ? (
                        <Link href={`/inventory/${entry.entityId}`} className="text-content-accent hover:underline">
                          {entry.entityType}
                        </Link>
                      ) : (
                        <span className="text-content-secondary">{entry.entityType}</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <AuditPaginationClient page={page} total={total} />
          </>
        )}
      </Card>
    </>
  )
}
