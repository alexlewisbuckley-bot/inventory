'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, PackageSearch, Receipt, SearchX } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useListQuery } from '@/hooks/useListQuery'
import { useColumnPreferences } from '@/hooks/useColumnPreferences'
import {
  Table, THead, TBody, TR, TD, TH, Pagination, StatusChip, UnpricedChip,
  EmptyState, Button, LinkButton, SkeletonTable, useCurrency,
} from '@/components/ui'
import { formatDate } from '@/lib/dates'
import { BulkActionBar } from './BulkActionBar'
import { ColumnPicker, type ColumnDefinition } from './ColumnPicker'
import { SavedViews } from './SavedViews'
import { QuickSellModal, type QuickSellTarget } from './QuickSellModal'
import { InlinePriceCell } from './InlinePriceCell'
import type { WatchListItem, WatchListResult } from '@/server/repositories/watch-repository'
import type { Capability } from '@/lib/permissions'
import type { FilterOption } from './FilterBar'

/**
 * Inventory columns.
 *
 * `locked` marks the two columns without which a row cannot be identified.
 * Serial and supplier are hidden by default: they matter when reconciling a
 * specific watch, but they crowd the everyday view.
 */
export const INVENTORY_COLUMNS: readonly ColumnDefinition[] = [
  { key: 'stockNo', label: 'Stock no', locked: true },
  { key: 'watch', label: 'Watch', locked: true },
  { key: 'serial', label: 'Serial' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'purchased', label: 'Purchased' },
  { key: 'cost', label: 'Cost' },
  { key: 'estSale', label: 'Est. sale' },
  { key: 'profit', label: 'Est. profit' },
  { key: 'location', label: 'Location' },
  { key: 'status', label: 'Status' },
]

const DEFAULT_HIDDEN = ['serial', 'supplier'] as const
const STORAGE_KEY = 'bluecroft.inventory.columns'

export interface InventoryTableProps {
  result: WatchListResult
  locations: FilterOption[]
  capabilities: Record<Capability, boolean>
}

/**
 * Inventory list.
 *
 * Selection is component state because it is ephemeral; sort, page and filters
 * live in the URL so a view can be shared. Clicking a row opens the detail
 * drawer via `?watch=` rather than navigating, so scroll position and
 * selection survive.
 */
export function InventoryTable({ result, locations, capabilities }: InventoryTableProps) {
  const query = useListQuery()
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sellTarget, setSellTarget] = useState<QuickSellTarget | null>(null)

  const columnKeys = useMemo(() => INVENTORY_COLUMNS.map((c) => c.key), [])
  const columns = useColumnPreferences(STORAGE_KEY, columnKeys, DEFAULT_HIDDEN)
  const show = (key: string) => !columns.isHidden(key)

  const sort = useMemo(
    () => ({ field: query.get('sort') ?? 'stockNo', dir: (query.get('dir') ?? 'desc') as 'asc' | 'desc' }),
    [query],
  )

  const selectable = capabilities['watch:move'] || capabilities['watch:delete']
  const allOnPageSelected = result.items.length > 0 && result.items.every((w) => selected.has(w.id))

  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current)
      if (allOnPageSelected) result.items.forEach((w) => next.delete(w.id))
      else result.items.forEach((w) => next.add(w.id))
      return next
    })
  }

  const toggleOne = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (query.isPending && result.items.length === 0) return <SkeletonTable rows={8} columns={8} />

  if (result.total === 0) {
    return query.activeFilterCount > 0 ? (
      <EmptyState
        variant="search"
        icon={<SearchX className="h-6 w-6" />}
        title="No watches match those filters"
        description="Try widening the date range, clearing a filter, or searching a different reference."
        action={<Button variant="secondary" onClick={query.clearAll}>Clear all filters</Button>}
      />
    ) : (
      <EmptyState
        icon={<PackageSearch className="h-6 w-6" />}
        title="No stock yet"
        description="Add your first watch and it will appear here with its cost, target price and location."
        action={capabilities['watch:create'] ? <LinkButton href="/inventory/new">Add a watch</LinkButton> : undefined}
      />
    )
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-6 py-3">
        <p className="text-small text-content-secondary">
          {result.total} {result.total === 1 ? 'watch' : 'watches'}
          {capabilities['watch:price'] && (
            <span className="ml-2 hidden text-caption text-content-secondary sm:inline">
              · click a price to edit it
            </span>
          )}
        </p>
        <ColumnPicker
          columns={INVENTORY_COLUMNS}
          isHidden={columns.isHidden}
          onToggle={columns.toggle}
          onReset={columns.showAll}
          hiddenCount={columns.hiddenCount}
        />
      </div>

      <div className={cn('transition-opacity', query.isPending && 'opacity-60')} aria-busy={query.isPending}>
        <Table>
          <THead>
            <TR>
              {selectable && (
                <TH width="44px">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleAll}
                    aria-label="Select all watches on this page"
                    className="h-4 w-4 rounded-[4px] accent-teal-500"
                  />
                </TH>
              )}
              <TH width="96px" sortKey="stockNo" sort={sort} onSort={query.sortBy}>Stock</TH>
              <TH sortKey="model" sort={sort} onSort={query.sortBy}>Watch</TH>
              {show('serial') && <TH width="110px">Serial</TH>}
              {show('supplier') && <TH width="150px">Supplier</TH>}
              {show('purchased') && <TH width="120px" sortKey="purchaseDate" sort={sort} onSort={query.sortBy}>Purchased</TH>}
              {show('cost') && <TH width="110px" align="right" sortKey="purchasePriceGbp" sort={sort} onSort={query.sortBy}>Cost</TH>}
              {show('estSale') && <TH width="110px" align="right" sortKey="estSaleUsd" sort={sort} onSort={query.sortBy}>Est. sale</TH>}
              {show('profit') && <TH width="110px" align="right" sortKey="margin" sort={sort} onSort={query.sortBy}>Est. profit</TH>}
              {show('location') && <TH width="150px" sortKey="location" sort={sort} onSort={query.sortBy}>Location</TH>}
              {show('status') && <TH width="130px">Status</TH>}
              <TH width="92px"><span className="sr-only">Actions</span></TH>
            </TR>
          </THead>
          <TBody>
            {result.items.map((watch) => (
              <Row
                key={watch.id}
                watch={watch}
                show={show}
                selectable={selectable}
                selected={selected.has(watch.id)}
                onToggle={() => toggleOne(watch.id)}
                canSell={capabilities['sale:create']}
                canPrice={capabilities['watch:price']}
                onSell={() => setSellTarget({
                  id: watch.id,
                  stockNo: watch.stockNo,
                  model: watch.model,
                  brandName: watch.brandName,
                  purchasePriceGbp: watch.purchasePriceGbp,
                  estSaleGbp: watch.estSaleGbp,
                })}
              />
            ))}
          </TBody>
        </Table>

        <Pagination
          page={result.page}
          perPage={result.perPage}
          total={result.total}
          noun="watch"
          onPage={(page) => query.set('page', String(page))}
          onPerPage={(perPage) => query.set('perPage', String(perPage))}
        />
      </div>

      {selected.size > 0 && (
        <BulkActionBar
          count={selected.size}
          watchIds={[...selected]}
          locations={locations}
          capabilities={capabilities}
          onClear={() => setSelected(new Set())}
        />
      )}

      <QuickSellModal
        open={sellTarget !== null}
        watch={sellTarget}
        onClose={() => setSellTarget(null)}
        onSold={() => router.refresh()}
      />
    </>
  )
}

function Row({ watch, show, selectable, selected, onToggle, canSell, canPrice, onSell }: {
  watch: WatchListItem
  show: (key: string) => boolean
  selectable: boolean
  selected: boolean
  onToggle: () => void
  canSell: boolean
  canPrice: boolean
  onSell: () => void
}) {
  const query = useListQuery()
  const { money, signed } = useCurrency()
  const sold = watch.status === 'SOLD'
  // Sold rows show realised figures; everything else shows the estimate.
  const profit = sold ? watch.actualProfitUsd : watch.estProfitGbp

  return (
    <TR selected={selected} className={cn('group', watch.deletedAt && 'opacity-50')}>
      {selectable && (
        <TD>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select stock number ${watch.stockNo}`}
            className="h-4 w-4 rounded-[4px] accent-teal-500"
          />
        </TD>
      )}
      <TD className="font-bold text-navy-700">{watch.stockNo}</TD>
      <TD>
        <button type="button" onClick={() => query.set('watch', watch.id)} className="text-left">
          <span className="block font-bold text-content-primary hover:underline">{watch.model}</span>
          <span className="block text-caption text-content-secondary">
            {watch.brandName}{watch.nickname ? ` · ${watch.nickname}` : ''}
          </span>
        </button>
      </TD>
      {show('serial') && <TD className="text-content-secondary">{watch.serial ?? '—'}</TD>}
      {show('supplier') && <TD className="text-content-secondary">{watch.supplierName}</TD>}
      {show('purchased') && <TD className="text-content-secondary">{formatDate(watch.purchaseDate)}</TD>}
      {show('cost') && <TD align="right" className="font-bold">{money(watch.purchasePriceGbp)}</TD>}
      {show('estSale') && (
        <TD align="right">
          {sold
            ? money(watch.estSaleGbp)
            : <InlinePriceCell watchId={watch.id} baseMinor={watch.estSaleGbp} editable={canPrice} />}
        </TD>
      )}
      {show('profit') && (
        <TD align="right" className={cn('font-bold', profit !== null && profit >= 0 ? 'text-content-accent' : profit !== null ? 'text-state-danger' : '')}>
          {profit !== null ? signed(profit) : '—'}
        </TD>
      )}
      {show('location') && <TD className="text-content-secondary">{watch.locationName}</TD>}
      {show('status') && (
        <TD>{watch.estSaleUsd === null && !sold ? <UnpricedChip /> : <StatusChip status={watch.status} />}</TD>
      )}
      <TD>
        <div className="flex items-center justify-end gap-0.5">
          {canSell && !sold && !watch.deletedAt && (
            <button
              type="button"
              onClick={onSell}
              title={`Mark stock ${watch.stockNo} as sold`}
              aria-label={`Mark stock number ${watch.stockNo} as sold`}
              className="inline-flex h-8 items-center gap-1 rounded-sm px-2 text-caption font-bold text-content-accent opacity-0 transition-opacity hover:bg-teal-100 focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Receipt className="h-3.5 w-3.5" aria-hidden />
              Sell
            </button>
          )}
          <Link
            href={`/inventory/${watch.id}`}
            aria-label={`Open full record for stock number ${watch.stockNo}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-content-secondary hover:bg-surface-subtle hover:text-content-primary"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </TD>
    </TR>
  )
}
