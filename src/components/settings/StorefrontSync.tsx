'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, Plus, RefreshCw, Trash2, Archive } from 'lucide-react'
import { Button, Card, CardBody, CardHeader, Chip, ConfirmDialog, useToast } from '@/components/ui'
import { applySyncAction, previewSyncAction, type PlanSummary } from '@/app/actions/shopify'

/**
 * The storefront, and what it would take to make it match the book.
 *
 * Two buttons and a list, in that order on purpose. The sync permanently
 * deletes product pages from a live shop, and there is no version of that
 * which should happen on one click from a screen showing no detail — so the
 * plan is read first, by name, and only then applied.
 */
export function StorefrontSync({ health }: {
  health: { configured: boolean; listed: number; failing: number; lastSyncedAt: string | null }
}) {
  const router = useRouter()
  const toast = useToast()
  const [plan, setPlan] = useState<PlanSummary | null>(null)
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
  const [confirming, setConfirming] = useState(false)

  const check = async () => {
    setBusy('preview')
    const result = await previewSyncAction()
    setBusy(null)
    if (!result.ok || !result.plan) {
      toast.error('Could not read the storefront', result.message)
      return
    }
    setPlan(result.plan)
  }

  const apply = async () => {
    setConfirming(false)
    setBusy('apply')
    const result = await applySyncAction()
    setBusy(null)
    if (result.ok) toast.success('Storefront updated', result.message)
    else toast.error('Finished with problems', result.message)
    setPlan(null)
    router.refresh()
  }

  const total = plan
    ? plan.create.length + plan.update.length + plan.archive.length + plan.remove.length
    : 0

  return (
    <>
      <Card>
        <CardHeader
          title="Online shop"
          description="The shop mirrors this system. Stock, prices and photographs are pushed out; nothing is read back."
          action={
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                onClick={check}
                loading={busy === 'preview'}
                disabled={!health.configured || busy !== null}
              >
                Check what would change
              </Button>
              {plan && total > 0 && (
                <Button
                  onClick={() => setConfirming(true)}
                  loading={busy === 'apply'}
                  disabled={busy !== null}
                >
                  Apply
                </Button>
              )}
            </div>
          }
        />
        <CardBody>
          {!health.configured ? (
            <p className="text-small text-content-secondary">
              Not connected. Set{' '}
              <code className="rounded-xs bg-surface-subtle px-1 font-mono text-caption">SHOPIFY_STORE_DOMAIN</code>,{' '}
              <code className="rounded-xs bg-surface-subtle px-1 font-mono text-caption">SHOPIFY_CLIENT_ID</code>,{' '}
              <code className="rounded-xs bg-surface-subtle px-1 font-mono text-caption">SHOPIFY_CLIENT_SECRET</code> and{' '}
              <code className="rounded-xs bg-surface-subtle px-1 font-mono text-caption">SHOPIFY_LOCATION_ID</code>, then redeploy.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-6">
              <Figure label="On the shop" value={String(health.listed)} />
              <Figure
                label="Failing"
                value={String(health.failing)}
                tone={health.failing > 0 ? 'danger' : undefined}
              />
              <Figure
                label="Last pushed"
                value={health.lastSyncedAt
                  ? new Date(health.lastSyncedAt).toLocaleString()
                  : 'Never'}
              />
            </div>
          )}

          {plan && total === 0 && (
            <p className="mt-4 flex items-center gap-2 text-small text-content-secondary">
              <Check className="h-4 w-4 text-state-success" aria-hidden />
              The shop already matches. Nothing to do.
            </p>
          )}

          {plan && total > 0 && (
            <div className="mt-5 flex flex-col gap-4">
              <Group
                icon={<Plus className="h-3.5 w-3.5" />}
                tone="accent"
                title={`${plan.create.length} to add`}
                items={plan.create.map((c) => `${c.stockNo} · ${c.title}`)}
              />
              <Group
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                tone="neutral"
                title={`${plan.update.length} to update`}
                items={plan.update.map((c) => `${c.stockNo} · ${c.title}`)}
              />
              <Group
                icon={<Archive className="h-3.5 w-3.5" />}
                tone="neutral"
                title={`${plan.archive.length} to hide`}
                items={plan.archive.map((c) => `${c.sku ?? '—'} · ${c.title}`)}
                note="Stock that has left the book. Hidden, and reversible."
              />
              <Group
                icon={<Trash2 className="h-3.5 w-3.5" />}
                tone="danger"
                title={`${plan.remove.length} to delete`}
                items={plan.remove.map((c) => `${c.sku ?? 'no SKU'} · ${c.title}`)}
                note="Products that answer to no watch. Deleted permanently — read this list before applying."
              />
            </div>
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={apply}
        tone="danger"
        title={plan?.remove.length
          ? `Delete ${plan.remove.length} product${plan.remove.length === 1 ? '' : 's'} and update the rest?`
          : 'Update the shop?'}
        message={plan?.remove.length
          ? 'The products in the delete list are removed permanently and cannot be brought back. Everything else is added, updated or hidden.'
          : 'The shop will be brought into line with this system.'}
        confirmLabel="Apply"
      />
    </>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div>
      <p className="text-caption font-semibold text-content-secondary">{label}</p>
      <p className={`mt-1 text-h3 font-extrabold tabular-nums ${tone === 'danger' ? 'text-state-danger' : 'text-content-primary'}`}>
        {value}
      </p>
    </div>
  )
}

/**
 * One kind of change, with its items named.
 *
 * Named rather than counted, because "3 to delete" tells somebody nothing they
 * can act on and "RM 011 Felipe Massa" tells them immediately whether this is
 * what they meant.
 */
function Group({ icon, title, items, tone, note }: {
  icon: React.ReactNode
  title: string
  items: string[]
  tone: 'accent' | 'neutral' | 'danger'
  note?: string
}) {
  if (items.length === 0) return null
  return (
    <div className={tone === 'danger' ? 'rounded-md border border-state-danger/40 bg-state-danger/5 p-4' : ''}>
      <p className="flex items-center gap-2 text-small font-bold text-content-primary">
        <Chip tone={tone === 'danger' ? 'danger' : tone === 'accent' ? 'accent' : 'neutral'}>
          <span className="flex items-center gap-1.5">{icon}{title}</span>
        </Chip>
        {tone === 'danger' && <AlertTriangle className="h-4 w-4 text-state-danger" aria-hidden />}
      </p>
      {note && <p className="mt-1.5 text-caption text-content-secondary">{note}</p>}
      <ul className="mt-2 flex flex-col gap-1">
        {items.slice(0, 40).map((item) => (
          <li key={item} className="truncate text-caption text-content-secondary">{item}</li>
        ))}
        {items.length > 40 && (
          <li className="text-caption text-content-muted">and {items.length - 40} more</li>
        )}
      </ul>
    </div>
  )
}
