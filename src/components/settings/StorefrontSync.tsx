'use client'
import { useState } from 'react'
import Link from 'next/link'
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
  health: {
    configured: boolean
    listed: number
    failing: number
    lastSyncedAt: string | null
    errors: Array<{ stockNo: number; message: string }>
    unmatched: Array<{ field: string; value: string; count: number }>
    withheld: Array<{ name: string; count: number }>
    invisible: Array<{ sku: string | null; title: string }>
  }
}) {
  const router = useRouter()
  const toast = useToast()
  const [plan, setPlan] = useState<PlanSummary | null>(null)
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

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

  /**
   * Apply, a batch at a time, saying where it has got to.
   *
   * One press used to mean one request carrying all hundred and thirty-one
   * watches — minutes of somebody else's API inside a request that is not
   * allowed to take minutes. It was killed part-way through every time, and
   * because it never returned, this button simply span. The work was half
   * done and the screen said nothing at all.
   *
   * Now each press pushes twenty and hands back a cursor, and this loop keeps
   * pressing until there is no cursor left. Every batch that finishes is
   * already saved, so a closed laptop costs the rest of the run and none of
   * what it had already done.
   */
  const apply = async () => {
    setConfirming(false)
    setBusy('apply')
    setProgress(null)

    let cursor: number | null = null
    let done = 0
    let total = 0
    let failures = 0
    let last: Awaited<ReturnType<typeof applySyncAction>> | null = null

    do {
      const result = await applySyncAction(cursor)
      last = result
      done += result.pushed
      failures += result.failed
      // The first batch is the one that knows how many there are in all.
      if (!total) total = result.total
      setProgress({ done, total })
      cursor = result.nextCursor
    } while (cursor !== null)

    setBusy(null)
    setProgress(null)
    if (last?.ok && failures === 0) toast.success('Storefront updated', last.message)
    else toast.error('Finished with problems', last?.message ?? 'The run stopped early.')
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
                value={formatWhen(health.lastSyncedAt)}
              />
            </div>
          )}

          {busy === 'apply' && (
            <div className="mt-4">
              <p className="text-small text-content-secondary">
                Pushing to the shop —{' '}
                <b className="tabular-nums text-content-primary">{progress?.done ?? 0}</b>
                {progress?.total ? <> of <span className="tabular-nums">{progress.total}</span></> : null}
                . This takes a few minutes; leave the page open.
              </p>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-subtle">
                <div
                  className="h-full rounded-full bg-state-success transition-all duration-500"
                  style={{ width: `${progress?.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {health.errors.length > 0 && (
            <div className="mt-4 rounded-md border border-state-danger/40 bg-state-danger/5 p-4">
              <p className="flex items-center gap-2 text-small font-bold text-content-primary">
                <AlertTriangle className="h-4 w-4 text-state-danger" aria-hidden />
                What the shop said
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {health.errors.map((error) => (
                  <li key={error.message} className="text-caption text-content-secondary">
                    <span className="font-semibold text-content-primary">Stock {error.stockNo}</span>
                    {' — '}{error.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/*
            Listed, correct, and not on the website.

            The one failure this page could not show, because from this side it
            is not a failure: the product is written, the row says synced, and
            nothing anywhere says that Shopify is keeping it out of its own
            shop window. It reads as a warning rather than an error for the
            same reason — the watches are right, and the next push fixes them —
            but it is first in the list, because it is the state somebody is
            looking at this page to explain.
          */}
          {health.invisible.length > 0 && (
            <div className="mt-4 rounded-md border border-state-warning/40 bg-state-warning/5 p-4">
              <p className="flex items-center gap-2 text-small font-bold text-content-primary">
                <AlertTriangle className="h-4 w-4 text-state-warning" aria-hidden />
                On the shop, but in no sales channel
              </p>
              <p className="mt-1 text-caption text-content-secondary">
                These pages exist and are priced, and Shopify is not showing them to anybody:
                they are in the admin only, which from the website is indistinguishable from
                never having been pushed. Press Apply and they go into the window. If they come
                back after a push, the app is missing the{' '}
                <span className="font-semibold text-content-primary">read_publications</span> and{' '}
                <span className="font-semibold text-content-primary">write_publications</span>{' '}
                permissions, which are granted to the app in Shopify.
              </p>
              <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
                {health.invisible.map((item) => (
                  <li key={item.sku ?? item.title} className="text-caption text-content-secondary">
                    <span className="font-semibold tabular-nums text-content-primary">
                      {item.sku ? `Stock ${item.sku}` : '—'}
                    </span>
                    {' '}{item.title}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/*
            Where the stock that is NOT on the shop has gone.

            This page showed a count of what is listed and said nothing at all
            about the rest, so the only way to find the switch that holds a
            location back was to already know it existed — somebody came here
            looking for it, which is a page failing at the one job it has.
            The setting itself stays on Locations, where the place is; this
            says it is on and points at it.
          */}
          {health.withheld.length > 0 && (
            <div className="mt-4 rounded-md border border-line-subtle bg-surface-subtle p-4">
              <p className="text-small font-bold text-content-primary">
                Kept off the shop
              </p>
              <p className="mt-1 text-caption text-content-secondary">
                Stock in these places is not pushed, and anything already there is taken
                down — they are watches nobody can come and see. Turn a place back on
                under{' '}
                <Link href="/locations" className="font-semibold text-content-primary underline underline-offset-2">
                  Locations
                </Link>
                {' '}and its stock returns to the shop on the next push.
              </p>
              <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
                {health.withheld.map((place) => (
                  <li key={place.name} className="text-caption text-content-secondary">
                    <span className="font-semibold text-content-primary">{place.name}</span>
                    {' '}
                    <span className="tabular-nums">
                      {place.count} {place.count === 1 ? 'watch' : 'watches'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {health.unmatched.length > 0 && (
            <div className="mt-4 rounded-md border border-line-subtle bg-surface-subtle p-4">
              <p className="text-small font-bold text-content-primary">
                The shop has no entry for these
              </p>
              <p className="mt-1 text-caption text-content-secondary">
                Not errors — the watches are listed and priced. But the shop filters on these, so
                a material with no entry is a material nobody can browse by. Add them under
                Settings → Custom data in Shopify, or change the wording here to match what the
                shop already calls them.
              </p>
              <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
                {health.unmatched.map((gap) => (
                  <li key={`${gap.field}-${gap.value}`} className="text-caption text-content-secondary">
                    <span className="font-mono text-content-muted">{gap.field}</span>
                    {' '}
                    <span className="font-semibold text-content-primary">{gap.value}</span>
                    {' '}
                    <span className="tabular-nums">×{gap.count}</span>
                  </li>
                ))}
              </ul>
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

/** A timestamp somebody can read, or an honest "never". */
function formatWhen(value: string | null): string {
  if (!value) return 'Never'
  const when = new Date(value)
  return Number.isNaN(when.getTime()) ? 'Unknown' : when.toLocaleString()
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
