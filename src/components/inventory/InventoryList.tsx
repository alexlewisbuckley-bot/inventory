'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LayoutGrid, MoreHorizontal, PackageSearch, Receipt, Rows3, SearchX } from 'lucide-react'
import { cn } from '@/lib/cn'
import { usePathname, useSearchParams } from 'next/navigation'
import { useListQuery } from '@/hooks/useListQuery'
import { useSelection } from '@/hooks/useSelection'
import { SelectAllBanner } from '@/components/ui/DataList'
import { useColumnPreferences } from '@/hooks/useColumnPreferences'
import { useDisplayMode, type DisplayMode } from '@/hooks/useDisplayMode'
import {
  Table, THead, TBody, TR, TD, TH, Pagination,
  EmptyState, Button, LinkButton, SkeletonTable, useCurrency,
} from '@/components/ui'
import { formatDate } from '@/lib/dates'
import { BulkActionBar } from './BulkActionBar'
import { ColumnPicker, type ColumnDefinition } from './ColumnPicker'
import {
  QuickSellModal, type QuickSellTarget, type SellCustomerOption, type SellDealOption,
} from './QuickSellModal'
import { InlinePriceCell } from './InlinePriceCell'
import { StatusCell } from './StatusCell'
import { InventoryGallery } from './InventoryGallery'
import { CheckDot } from '@/components/compliance/CheckLight'
import { CHECK_TONE_LABELS, watchChecks } from '@/lib/checks'
import { VoidSaleModal, type VoidTarget } from './VoidSaleModal'
import { PRODUCT_TYPE_LABELS } from '@/lib/enums'
import type { WatchStatus } from '@/lib/enums'
import type { WatchListItem, WatchListResult } from '@/server/repositories/watch-repository'
import type { Capability } from '@/lib/permissions'

/**
 * Inventory columns.
 *
 * `locked` marks the two columns without which a row cannot be identified.
 * Serial and supplier are hidden by default: they matter when reconciling a
 * specific watch, but they crowd the everyday view.
 */
export const INVENTORY_COLUMNS: readonly ColumnDefinition[] = [
  { key: 'stockNo', label: 'Stock no', locked: true },
  { key: 'watch', label: 'Reference', locked: true },
  { key: 'year', label: 'Year' },
  { key: 'serial', label: 'Serial' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'purchased', label: 'Purchased' },
  { key: 'cost', label: 'Cost' },
  { key: 'trade', label: 'Trade' },
  { key: 'estSale', label: 'Retail' },
  { key: 'profit', label: 'Est. profit' },
  { key: 'location', label: 'Location' },
  { key: 'owner', label: 'Owner' },
  { key: 'status', label: 'Status' },
  { key: 'checks', label: 'Checks' },
]

/**
 * Column widths, in pixels, in one place.
 *
 * The table lays out `fixed`, so these are honoured exactly rather than
 * treated as hints — which is the point, but it means the table has to be
 * told how wide it needs to be before it will scroll instead of squeezing.
 * Both the headers and that minimum are computed from this map, so they
 * cannot drift apart.
 */
const COL_WIDTH = {
  select: 56, stockNo: 84, year: 72, serial: 96, supplier: 140, purchased: 116,
  cost: 96, trade: 96, estSale: 104, profit: 116, location: 140, owner: 140,
  status: 118, checks: 92, actions: 104,
} as const

/**
 * The floor for the elastic column.
 *
 * It takes whatever the others leave, and with enough columns showing that
 * was nothing at all: measured at 0px, with the watch — the one thing every
 * row is actually identified by — collapsed to an empty sliver while twelve
 * fixed columns sat at their full width. Below this the table scrolls
 * sideways instead.
 */
const WATCH_MIN = 200

// Owner starts hidden like serial and supplier: it matters to whoever is
// reconciling ownership, not to everyone reading the list every day.
const DEFAULT_HIDDEN = ['serial', 'supplier', 'owner'] as const
const STORAGE_KEY = 'bluecroft.inventory.columns'

export interface InventoryListProps {
  result: WatchListResult
  locations: Array<{ id: string; name: string }>
  capabilities: Record<Capability, boolean>
  /** The customer book, so a sale can be attributed without leaving the row. */
  customers?: SellCustomerOption[]
  /** Open deals keyed by watch, so selling one closes the deal it came from. */
  dealsByWatch?: Record<string, SellDealOption[]>
}

/**
 * Inventory list.
 *
 * Renders the same rows as a table or as a gallery of photographs — one
 * component rather than two routes, because selection, filters, paging, the
 * sell and void dialogs and the drawer are identical either way and only the
 * drawing differs. Splitting them would mean keeping two copies of all of it
 * in step.
 *
 * Selection is component state because it is ephemeral; sort, page, filters
 * and the chosen display live in the URL so a view can be shared. Clicking a
 * row or a card opens the detail drawer via `?watch=` rather than navigating,
 * so scroll position and selection survive.
 */
export function InventoryList({
  result, locations, capabilities, customers = [], dealsByWatch = {},
}: InventoryListProps) {
  const query = useListQuery()
  const router = useRouter()
  // Selection knows the difference between "these rows" and "everything that
  // matches", which is the whole reason a filtered list of three hundred can
  // now be acted on at all.
  const selection = useSelection(result.total)
  const [sellTarget, setSellTarget] = useState<QuickSellTarget | null>(null)
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null)

  // Money columns the role may not see are not columns at all here — not
  // hidden, absent. The page has already nulled the figures; this stops the
  // headers advertising data that will never arrive.
  const visibleColumns = useMemo(() => INVENTORY_COLUMNS.filter((column) => {
    if ((column.key === 'cost' || column.key === 'profit') && !capabilities['cost:read']) return false
    if (column.key === 'estSale' && !capabilities['revenue:read']) return false
    return true
  }), [capabilities])

  const columnKeys = useMemo(() => visibleColumns.map((c) => c.key), [visibleColumns])
  const columns = useColumnPreferences(STORAGE_KEY, columnKeys, DEFAULT_HIDDEN)
  const show = (key: string) => !columns.isHidden(key) && columnKeys.includes(key)
  const { mode, setMode } = useDisplayMode()
  // The gallery cards link to the drawer the same way the table rows do, so
  // the URL is built once here rather than twice in two components.
  const listPath = usePathname()
  const listParams = useSearchParams()

  const sort = useMemo(
    () => ({ field: query.get('sort') ?? 'stockNo', dir: (query.get('dir') ?? 'desc') as 'asc' | 'desc' }),
    [query],
  )

  const selectable = capabilities['watch:move'] || capabilities['watch:delete']

  /**
   * How wide the table needs to be for every column to hold its stated width
   * and the watch still to be readable. Below it the wrapper scrolls, which
   * is the honest answer when twelve columns are switched on at once — better
   * than every one of them being quietly squeezed.
   */
  const tableMinWidth = `${
    (selectable ? COL_WIDTH.select : 0) + COL_WIDTH.stockNo + WATCH_MIN + COL_WIDTH.actions
    + (['year', 'serial', 'supplier', 'purchased', 'cost', 'trade', 'estSale', 'profit',
        'location', 'owner', 'status', 'checks'] as const)
      .reduce((sum, key) => sum + (show(key) ? COL_WIDTH[key] : 0), 0)
  }px`
  const pageIds = useMemo(() => result.items.map((item) => item.id), [result.items])
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selection.isSelected(id))

  const toggleAll = () => selection.togglePage(pageIds)
  const toggleOne = (id: string) => selection.toggle(id)

  // ⌘A selects the page, and the banner then offers the rest. Two steps rather
  // than one: silently selecting four hundred rows because somebody pressed a
  // familiar shortcut is how a bulk delete goes wrong.
  useEffect(() => {
    if (!selectable) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'a' || (!event.metaKey && !event.ctrlKey)) return
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      event.preventDefault()
      selection.togglePage(pageIds)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectable, pageIds, selection])

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
        description="Add your first item and it will appear here with its cost, target price and location."
        action={capabilities['watch:create'] ? <LinkButton href="/inventory/new">Add an item</LinkButton> : undefined}
      />
    )
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-6 py-3">
        <p className="text-small text-content-secondary">
          {result.total} {result.total === 1 ? 'watch' : 'watches'}
          {capabilities['watch:price'] && mode === 'table' && (
            <span className="ml-2 hidden text-caption text-content-secondary sm:inline">
              · click a price to edit it
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <DisplaySwitch mode={mode} onChange={setMode} />
          {/* The picker chooses table columns: nothing for it to do in the
              gallery, and below sm there is no table either. */}
          {mode === 'table' && (
            <div className="hidden sm:block">
              <ColumnPicker
                columns={visibleColumns}
                isHidden={columns.isHidden}
                onToggle={columns.toggle}
                onReset={columns.showAll}
                hiddenCount={columns.hiddenCount}
              />
            </div>
          )}
        </div>
      </div>

      <div className={cn('transition-opacity', query.isPending && 'opacity-60')} aria-busy={query.isPending}>
        {mode === 'gallery' ? (
          <InventoryGallery
            items={result.items}
            selectable={selectable}
            isSelected={selection.isSelected}
            onToggle={toggleOne}
            canSeeCost={capabilities['cost:read']}
            canSeeRevenue={capabilities['revenue:read']}
            href={(id) => `${listPath}?${withParam(listParams, 'watch', id)}`}
          />
        ) : (
        <>
        {/* Below sm the table would need to be scrolled sideways to reach any
            figure, so the same rows are rendered as cards instead: the two
            numbers that matter and the status, in one tap-sized target. */}
        <ul className="divide-y divide-line-subtle sm:hidden">
          {result.items.map((watch) => (
            <MobileRow
              key={watch.id}
              watch={watch}
              canEditStatus={capabilities['watch:update']}
              canSell={capabilities['sale:create']}
              canVoid={capabilities['sale:delete']}
              onVoid={() => setVoidTarget({
                id: watch.id,
                stockNo: watch.stockNo,
                label: `${watch.brandName} ${watch.model}`,
              })}
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
        </ul>

        <div className="hidden sm:block">
        <Table layout="fixed" minWidth={tableMinWidth}>
          <THead>
            <TR>
              {selectable && (
                <TH width={`${COL_WIDTH.select}px`} className="hidden sm:table-cell">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleAll}
                    aria-label="Select all watches on this page"
                    className="h-4 w-4 rounded-xs accent-teal-500"
                  />
                </TH>
              )}
              <TH width={`${COL_WIDTH.stockNo}px`} sortKey="stockNo" sort={sort} onSort={query.sortBy}>Stock</TH>
              {/* The elastic column, and the only one without a width: under
                  `table-fixed` the leftover goes to whichever column states
                  none, so the watch takes it and the rest stay put. */}
              <TH sortKey="model" sort={sort} onSort={query.sortBy}>Watch</TH>
              {show('year') && <TH width={`${COL_WIDTH.year}px`} sortKey="year" sort={sort} onSort={query.sortBy}>Year</TH>}
              {show('serial') && <TH width={`${COL_WIDTH.serial}px`}>Serial</TH>}
              {show('supplier') && <TH width={`${COL_WIDTH.supplier}px`}>Supplier</TH>}
              {show('purchased') && <TH width={`${COL_WIDTH.purchased}px`} sortKey="purchaseDate" sort={sort} onSort={query.sortBy}>Purchased</TH>}
              {show('cost') && <TH width={`${COL_WIDTH.cost}px`} align="right" sortKey="purchasePriceGbp" sort={sort} onSort={query.sortBy}>Cost</TH>}
              {show('trade') && <TH width={`${COL_WIDTH.trade}px`} align="right" sortKey="tradePriceGbp" sort={sort} onSort={query.sortBy}>Trade</TH>}
              {show('estSale') && <TH width={`${COL_WIDTH.estSale}px`} align="right" sortKey="estSaleUsd" sort={sort} onSort={query.sortBy}>Retail</TH>}
              {show('profit') && <TH width={`${COL_WIDTH.profit}px`} align="right" sortKey="margin" sort={sort} onSort={query.sortBy}>Est. profit</TH>}
              {show('location') && <TH width={`${COL_WIDTH.location}px`} sortKey="location" sort={sort} onSort={query.sortBy}>Location</TH>}
              {show('owner') && <TH width={`${COL_WIDTH.owner}px`} sortKey="owner" sort={sort} onSort={query.sortBy}>Owner</TH>}
              {show('status') && <TH width={`${COL_WIDTH.status}px`}>Status</TH>}
              {show('checks') && <TH width={`${COL_WIDTH.checks}px`} align="center">Checks</TH>}
              {/* Wide enough for Sell beside the menu, which only appears on
                  hover — a narrower column would clip it under `table-fixed`. */}
              <TH width={`${COL_WIDTH.actions}px`} align="right"><span className="sr-only">Actions</span></TH>
            </TR>
          </THead>
          <TBody>
            {result.items.map((watch) => (
              <Row
                key={watch.id}
                watch={watch}
                show={show}
                selectable={selectable}
                selected={selection.isSelected(watch.id)}
                onToggle={() => toggleOne(watch.id)}
                canSell={capabilities['sale:create']}
                canPrice={capabilities['watch:price']}
                canEditStatus={capabilities['watch:update']}
                canVoid={capabilities['sale:delete']}
                onVoid={() => setVoidTarget({
                  id: watch.id,
                  stockNo: watch.stockNo,
                  label: `${watch.brandName} ${watch.model}`,
                })}
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
        </div>
        </>
        )}

        {selectable && allOnPageSelected && (
          <SelectAllBanner
            pageCount={pageIds.length}
            total={result.total}
            allMatching={selection.isAllMatching}
            onSelectAll={selection.selectAllMatching}
            onClear={selection.clear}
          />
        )}

        <Pagination
          page={result.page}
          perPage={result.perPage}
          total={result.total}
          noun="watch"
          onPage={(page) => query.set('page', String(page))}
          onPerPage={(perPage) => query.set('perPage', String(perPage))}
        />
      </div>

      {!selection.empty && (
        <BulkActionBar
          count={selection.count}
          watchIds={selection.state.ids as string[]}
          allMatching={selection.isAllMatching}
          locations={locations}
          capabilities={capabilities}
          onClear={selection.clear}
        />
      )}

      <QuickSellModal
        open={sellTarget !== null}
        watch={sellTarget}
        customers={customers}
        deals={sellTarget ? dealsByWatch[sellTarget.id] ?? [] : []}
        onClose={() => setSellTarget(null)}
        onSold={() => router.refresh()}
      />

      <VoidSaleModal
        open={voidTarget !== null}
        target={voidTarget}
        onClose={() => setVoidTarget(null)}
        onVoided={() => router.refresh()}
      />
    </>
  )
}

/**
 * One watch as a card, for phones.
 *
 * The desktop row carries ten columns. On a 390px screen the same markup can
 * only show two of them without a sideways scroll, which means the price — the
 * reason anyone opens this list — is off-screen. The card keeps the identity,
 * both figures and the status visible, and the whole card opens the record.
 */
function MobileRow({ watch, canEditStatus, canSell, canVoid, onSell, onVoid }: {
  watch: WatchListItem
  canEditStatus: boolean
  canSell: boolean
  canVoid: boolean
  onSell: () => void
  onVoid: () => void
}) {
  const query = useListQuery()
  const pathname = usePathname()
  const params = useSearchParams()
  const { money, signed } = useCurrency()
  const sold = watch.status === 'SOLD'
  const profit = sold ? watch.actualProfitGbp : watch.estProfitGbp

  return (
    <li className={cn('px-4 py-3.5', watch.deletedAt && 'opacity-50')}>
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => query.set('watch', watch.id)}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-body font-bold text-content-primary">
            {watch.brandName} {watch.model}
          </span>
          <span className="mt-0.5 block truncate text-caption text-content-secondary">
            Stock {watch.stockNo} · {watch.locationName}
            {watch.productType !== 'WATCH' && ` · ${PRODUCT_TYPE_LABELS[watch.productType]}`}
          </span>
        </button>
        <StatusCell
          watchId={watch.id}
          status={watch.status as WatchStatus}
          editable={canEditStatus && !watch.deletedAt}
          canSell={canSell}
          onSell={onSell}
          canVoid={canVoid}
          onVoid={onVoid}
        />
      </div>

      <dl className="mt-2.5 flex items-baseline gap-4 text-caption">
        <div className="min-w-0">
          <dt className="text-content-secondary">Cost</dt>
          <dd className="truncate font-bold tabular-nums text-content-primary">{money(watch.purchasePriceGbp)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-content-secondary">{sold ? 'Sold for' : 'Retail'}</dt>
          <dd className="truncate font-bold tabular-nums text-content-primary">
            {sold && watch.soldAmountGbp !== null
              ? money(watch.soldAmountGbp)
              : watch.estSaleGbp !== null ? money(watch.estSaleGbp) : 'No price'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-content-secondary">{sold ? 'Profit' : 'Est. profit'}</dt>
          <dd className={cn(
            'truncate font-bold tabular-nums',
            profit !== null && profit >= 0 ? 'text-content-accent' : profit !== null ? 'text-state-danger' : 'text-content-secondary',
          )}>
            {profit !== null ? signed(profit) : '—'}
          </dd>
        </div>
      </dl>
    </li>
  )
}


/** The current query with one parameter set, for a link that opens a drawer. */
function withParam(params: URLSearchParams, key: string, value: string): string {
  const next = new URLSearchParams(params.toString())
  next.set(key, value)
  return next.toString()
}

/**
 * Table or gallery.
 *
 * Two icon buttons rather than a dropdown: there are two options, both are
 * one glance to understand, and a menu would hide the choice behind a click.
 * Labelled for anybody who cannot see the icons, and pressed-state carried on
 * the button so it is announced as a toggle rather than as a link.
 */
function DisplaySwitch({ mode, onChange }: { mode: DisplayMode; onChange: (mode: DisplayMode) => void }) {
  const options = [
    { value: 'table' as const, label: 'Table', icon: Rows3 },
    { value: 'gallery' as const, label: 'Gallery', icon: LayoutGrid },
  ]
  return (
    <div className="inline-flex rounded-md border border-line-subtle bg-surface-subtle p-0.5" role="group" aria-label="How to show the stock">
      {options.map((option) => {
        const Icon = option.icon
        const active = mode === option.value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            aria-label={`${option.label} view`}
            title={`${option.label} view`}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-caption font-semibold transition-colors',
              active
                ? 'bg-surface-raised text-content-primary shadow-sm'
                : 'text-content-secondary hover:text-content-primary',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function Row({
  watch, show, selectable, selected, onToggle,
  canSell, canPrice, canEditStatus, canVoid, onSell, onVoid,
}: {
  watch: WatchListItem
  show: (key: string) => boolean
  selectable: boolean
  selected: boolean
  onToggle: () => void
  canSell: boolean
  canPrice: boolean
  canEditStatus: boolean
  canVoid: boolean
  onSell: () => void
  onVoid: () => void
}) {
  const query = useListQuery()
  const pathname = usePathname()
  const params = useSearchParams()
  const { money, signed } = useCurrency()
  const sold = watch.status === 'SOLD'
  // Sold rows show realised figures; everything else shows the estimate.
  const profit = sold ? watch.actualProfitGbp : watch.estProfitGbp
  const checks = watchChecks({
    vatNo: watch.supplierVatNo,
    entityType: watch.supplierEntityType,
    vatCheckStatus: watch.supplierVatCheckStatus,
    vatCheckedAt: watch.supplierVatCheckedAt,
    directorName: watch.supplierDirectorName,
    idCheckStatus: watch.supplierIdCheckStatus,
    idCheckedAt: watch.supplierIdCheckedAt,
    idDocumentExpiresOn: watch.supplierIdDocumentExpiresOn,
    serial: watch.serial,
    registerCheckStatus: watch.registerCheckStatus,
    registerCheckedAt: watch.registerCheckedAt,
  })

  return (
    <TR
      selected={selected}
      peek={{ kind: 'watch', id: watch.id }}
      className={cn('group', watch.deletedAt && 'opacity-50')}
    >
      {selectable && (
        <TD className="hidden sm:table-cell">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select stock number ${watch.stockNo}`}
            className="h-4 w-4 rounded-xs accent-teal-500"
          />
        </TD>
      )}
      <TD className="truncate font-bold text-navy-700" title={String(watch.stockNo)}>{watch.stockNo}</TD>
      <TD>
        {/* A link, not a button. It goes to a URL — `?watch=…` opens the
            drawer — so it should be middle-clickable and copyable like every
            other route to a record. It was also the only two-line "control"
            in the product, which is how a 38px height nothing else uses got
            into the computed-style audit. */}
        <Link
          href={`${pathname}?${withParam(params, 'watch', watch.id)}`}
          scroll={false}
          className="block text-left"
        >
          <span className="block truncate font-bold text-content-primary hover:underline" title={watch.model}>{watch.model}</span>
          <span className="block truncate text-caption text-content-secondary">
            {watch.brandName}
            {/* Marked only when it is not a watch. Nearly every row is one, so
                a type on every row would be a column of the same word — the
                thing worth seeing at a glance is the exception. */}
            {watch.productType !== 'WATCH' && (
              <> · <span className="font-bold text-navy-700">{PRODUCT_TYPE_LABELS[watch.productType]}</span></>
            )}
          </span>
        </Link>
      </TD>
      {/* Tabular figures so the years line up as a column of digits rather
          than drifting against each other. */}
      {show('year') && (
        <TD className="tabular-nums text-content-secondary">
          {watch.year ?? <span className="text-content-muted">—</span>}
        </TD>
      )}
      {show('serial') && (
        <TD className="truncate text-content-secondary" title={watch.serial ?? undefined}>
          {watch.serial ?? <span className="text-content-muted">—</span>}
        </TD>
      )}
      {show('supplier') && (
        <TD className="text-content-secondary">
          <span className="block truncate" title={watch.supplierName}>{watch.supplierName}</span>
        </TD>
      )}
      {show('purchased') && <TD className="text-content-secondary">{formatDate(watch.purchaseDate)}</TD>}
      {show('cost') && <TD align="right" className="font-bold">{money(watch.purchasePriceGbp)}</TD>}
      {/* Between the two it sits between, in the same order as the form. A
          watch never offered to the trade says so rather than showing a
          zero. */}
      {show('trade') && (
        <TD align="right" className="text-content-secondary">
          {watch.tradePriceGbp === null
            ? <span className="text-content-muted">—</span>
            : money(watch.tradePriceGbp)}
        </TD>
      )}
      {show('estSale') && (
        <TD align="right">
          {/* A sold watch shows what it actually made, not what somebody once
              hoped it would. */}
          {sold
            ? money(watch.soldAmountGbp ?? watch.estSaleGbp)
            : <InlinePriceCell watchId={watch.id} baseMinor={watch.estSaleGbp} editable={canPrice} />}
        </TD>
      )}
      {show('profit') && (
        <TD align="right" className={cn('font-bold', profit !== null && profit >= 0 ? 'text-content-accent' : profit !== null ? 'text-state-danger' : '')}>
          {profit !== null ? signed(profit) : '—'}
        </TD>
      )}
      {show('location') && (
        <TD className="text-content-secondary">
          <span className="block truncate" title={watch.locationName}>{watch.locationName}</span>
        </TD>
      )}
      {show('owner') && (
        <TD className="text-content-secondary">
          {/* Not a dash. Unowned stock is a question nobody has answered yet,
              and saying so is what gets it answered. */}
          {watch.ownerName
            ? <span className="block truncate" title={watch.ownerName}>{watch.ownerName}</span>
            : <span className="text-content-tertiary">Unassigned</span>}
        </TD>
      )}
      {show('status') && (
        <TD>
          <StatusCell
            watchId={watch.id}
            status={watch.status as WatchStatus}
            editable={canEditStatus && !watch.deletedAt}
            canSell={canSell}
            onSell={onSell}
            canVoid={canVoid}
            onVoid={onVoid}
          />
        </TD>
      )}
      {show('checks') && (
        <TD align="center">
          <CheckDot tone={checks.tone} label={`${CHECK_TONE_LABELS[checks.tone]} — ${checks.summary}`} />
        </TD>
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
