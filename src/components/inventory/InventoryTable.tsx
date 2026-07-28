'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { MoreHorizontal, PackageSearch, SearchX } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useListQuery } from '@/hooks/useListQuery'
import {
  Table, THead, TBody, TR, TD, TH, Pagination, StatusChip, UnpricedChip,
  EmptyState, Button, LinkButton, SkeletonTable,
} from '@/components/ui'
import { formatMoney, formatSigned } from '@/lib/money'
import { formatDate } from '@/lib/dates'
import { BulkActionBar } from './BulkActionBar'
import type { WatchListItem, WatchListResult } from '@/server/repositories/watch-repository'
import type { Capability } from '@/lib/permissions'
import type { FilterOption } from './FilterBar'

export interface InventoryTableProps {
  result: WatchListResult
  locations: FilterOption[]
  capabilities: Record<Capability, boolean>
}

/**
 * Inventory list.
 *
 * Selection lives in component state (not the URL) because it is ephemeral,
 * while sort/page/filter live in the URL so a view can be shared. Clicking a
 * row opens the detail drawer via `?watch=<id>` rather than navigating, so the
 * user keeps their scroll position and filters.
 */
export function InventoryTable({ result, locations, capabilities }: InventoryTableProps) {
  const query = useListQuery()
  const [selected, setSelected] = useState<Set<string>>(new Set())

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
    const filtered = query.activeFilterCount > 0
    return filtered ? (
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
              <TH width="88px" sortKey="stockNo" sort={sort} onSort={query.sortBy}>Stock no</TH>
              <TH sortKey="model" sort={sort} onSort={query.sortBy}>Watch</TH>
              <TH width="110px">Serial</TH>
              <TH width="150px">Supplier</TH>
              <TH width="120px" sortKey="purchaseDate" sort={sort} onSort={query.sortBy}>Purchased</TH>
              <TH width="110px" align="right" sortKey="purchasePriceGbp" sort={sort} onSort={query.sortBy}>Cost (£)</TH>
              <TH width="110px" align="right" sortKey="estSaleUsd" sort={sort} onSort={query.sortBy}>Est. sale ($)</TH>
              <TH width="110px" align="right" sortKey="margin" sort={sort} onSort={query.sortBy}>Est. profit</TH>
              <TH width="150px" sortKey="location" sort={sort} onSort={query.sortBy}>Location</TH>
              <TH width="130px">Status</TH>
              <TH width="48px"><span className="sr-only">Actions</span></TH>
            </TR>
          </THead>
          <TBody>
            {result.items.map((watch) => (
              <Row
                key={watch.id}
                watch={watch}
                selectable={selectable}
                selected={selected.has(watch.id)}
                onToggle={() => toggleOne(watch.id)}
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
    </>
  )
}

function Row({ watch, selectable, selected, onToggle }: {
  watch: WatchListItem; selectable: boolean; selected: boolean; onToggle: () => void
}) {
  const query = useListQuery()
  const sold = watch.status === 'SOLD'
  const profit = sold ? watch.actualProfitUsd : watch.estProfitUsd

  return (
    <TR selected={selected} className={cn(watch.deletedAt && 'opacity-50')}>
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
        <button
          type="button"
          onClick={() => query.set('watch', watch.id)}
          className="text-left"
        >
          <span className="block font-bold text-content-primary hover:underline">{watch.model}</span>
          <span className="block text-caption text-content-secondary">
            {watch.brandName}{watch.nickname ? ` · ${watch.nickname}` : ''}
          </span>
        </button>
      </TD>
      <TD className="text-content-secondary">{watch.serial ?? '—'}</TD>
      <TD className="text-content-secondary">{watch.supplierName}</TD>
      <TD className="text-content-secondary">{formatDate(watch.purchaseDate)}</TD>
      <TD align="right" className="font-bold">{formatMoney(watch.purchasePriceGbp, 'GBP')}</TD>
      <TD align="right">
        {sold ? formatMoney(watch.soldAmountUsd, 'USD') : formatMoney(watch.estSaleUsd, 'USD')}
      </TD>
      <TD align="right" className={cn('font-bold', profit !== null && profit >= 0 ? 'text-content-accent' : profit !== null ? 'text-state-danger' : '')}>
        {profit !== null ? formatSigned(profit, 'USD') : '—'}
      </TD>
      <TD className="text-content-secondary">{watch.locationName}</TD>
      <TD>
        {watch.estSaleUsd === null && !sold ? <UnpricedChip /> : <StatusChip status={watch.status} />}
      </TD>
      <TD>
        <Link
          href={`/inventory/${watch.id}`}
          aria-label={`Open full record for stock number ${watch.stockNo}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-content-secondary hover:bg-surface-subtle hover:text-content-primary"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </Link>
      </TD>
    </TR>
  )
}
