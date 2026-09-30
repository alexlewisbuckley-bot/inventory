'use client'
import { LayoutGrid, PackageSearch, Rows3, Search, X } from 'lucide-react'
import { useListQuery } from '@/hooks/useListQuery'
import { Card, EmptyState, Pagination, Chip, Table, THead, TBody, TR, TD, TH } from '@/components/ui'
import { formatCurrency } from '@/lib/currency'
import { cn } from '@/lib/cn'
import {
  BOX_PAPERS_LABELS, CONDITION_LABELS,
  type BoxPapers, type Condition, type CurrencyCode,
} from '@/lib/enums'
import type { CataloguePage, CatalogueItem } from '@/server/services/catalogue-service'

const SORTS = [
  { value: 'brand', label: 'Brand, A–Z' },
  { value: 'trade-desc', label: 'Trade, high to low' },
  { value: 'trade-asc', label: 'Trade, low to high' },
  { value: 'year-desc', label: 'Year, newest' },
]

export function CatalogueGrid({ result, currency }: {
  result: CataloguePage
  currency: CurrencyCode
}) {
  const query = useListQuery()
  const brand = query.get('brand') ?? ''
  const sort = query.get('sort') ?? 'brand'
  const q = query.get('q') ?? ''
  const quotedOnly = query.get('quotedOnly') === 'true'
  const view = query.get('view') === 'table' ? 'table' : 'gallery'
  const filtering = Boolean(brand || q || quotedOnly)

  return (
    <div className={cn('transition-opacity', query.isPending && 'opacity-60')} aria-busy={query.isPending}>
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <label className="relative min-w-[220px] flex-1">
            <span className="sr-only">Search the inventory</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" aria-hidden />
            <input
              type="search"
              defaultValue={q}
              onChange={(event) => query.set('q', event.target.value || null)}
              placeholder="Reference, model, dial, metal"
              className="h-10 w-full rounded-md border border-line-subtle bg-surface-raised pl-9 pr-3 text-body outline-none focus:border-teal-500"
            />
          </label>

          <label className="flex items-center gap-2">
            <span className="text-caption font-semibold text-content-secondary">Brand</span>
            <select
              value={brand}
              onChange={(event) => query.set('brand', event.target.value || null)}
              className="h-10 rounded-md border border-line-subtle bg-surface-raised px-2 text-body outline-none focus:border-teal-500"
            >
              <option value="">All brands</option>
              {result.brands.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-caption font-semibold text-content-secondary">Order</span>
            <select
              value={sort}
              onChange={(event) => query.set('sort', event.target.value)}
              className="h-10 rounded-md border border-line-subtle bg-surface-raised px-2 text-body outline-none focus:border-teal-500"
            >
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>

          <label className="flex items-center gap-2 text-body text-content-secondary">
            <input
              type="checkbox"
              checked={quotedOnly}
              onChange={(event) => query.set('quotedOnly', event.target.checked ? 'true' : null)}
              className="h-4 w-4 accent-teal-600"
            />
            Trade priced only
          </label>

          {filtering && (
            <button
              type="button"
              onClick={() => { query.set('q', null); query.set('brand', null); query.set('quotedOnly', null) }}
              className="inline-flex items-center gap-1 text-caption text-content-secondary hover:text-content-primary"
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Clear
            </button>
          )}

          {/* Two ways to read the same stock. A buyer choosing a piece wants
              the photographs; a buyer pricing thirty of them wants the
              numbers in a column they can run an eye down. The choice rides
              in the URL, so it survives a reload and a shared link. */}
          <div className="ml-auto flex items-center gap-0.5 rounded-md border border-line-subtle p-0.5" role="group" aria-label="View">
            <ViewButton active={view === 'gallery'} onClick={() => query.set('view', null)} icon={<LayoutGrid className="h-4 w-4" aria-hidden />} label="Gallery" />
            <ViewButton active={view === 'table'} onClick={() => query.set('view', 'table')} icon={<Rows3 className="h-4 w-4" aria-hidden />} label="Table" />
          </div>
        </div>
      </Card>

      {result.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PackageSearch className="h-6 w-6" aria-hidden />}
            title={filtering ? 'Nothing here matches that.' : 'Nothing is available just now.'}
            description={filtering
              ? 'Try a wider search, or clear the filters.'
              : 'Please check back shortly — stock moves daily.'}
          />
        </Card>
      ) : (
        view === 'table' ? (
          <CatalogueTable items={result.items} currency={currency} />
        ) : (
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {result.items.map((item) => <Tile key={item.id} item={item} currency={currency} />)}
          </ul>
        )
      )}

      <Pagination
        page={result.page}
        perPage={result.perPage}
        total={result.total}
        noun="piece"
        onPage={(page) => query.set('page', String(page))}
        onPerPage={(perPage) => query.set('perPage', String(perPage))}
      />
    </div>
  )
}

function Tile({ item, currency }: { item: CatalogueItem; currency: CurrencyCode }) {
  const condition = item.condition === 'UNKNOWN' ? null : CONDITION_LABELS[item.condition as Condition]
  const set = item.boxPapers === 'UNKNOWN' ? null : BOX_PAPERS_LABELS[item.boxPapers as BoxPapers]
  const facts = [
    item.year ? String(item.year) : null,
    item.caseSizeMm ? `${item.caseSizeMm}mm` : null,
    item.caseMaterial,
    item.dial ? `${item.dial} dial` : null,
  ].filter(Boolean) as string[]

  return (
    <li>
      <Card className="flex h-full flex-col overflow-hidden">
        {/* Square, because the stock is photographed every which way and a
            grid of five mixed ratios reads as a mistake. object-contain keeps
            the whole watch in frame; the padding stops it touching the edge. */}
        <div className="aspect-square w-full bg-surface-subtle">
          {item.imageId ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={`/api/images/${item.imageId}`}
              alt={`${item.brandName} ${item.modelName ?? item.model}`}
              loading="lazy"
              className="h-full w-full object-contain p-4"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-caption text-content-muted">
              Photograph to follow
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1 p-4">
          <p className="text-caption font-semibold uppercase tracking-wide text-content-secondary">
            {item.brandName}
          </p>
          <h2 className="text-body font-bold text-content-primary">{item.modelName ?? item.model}</h2>
          {/* Only when it says something the heading did not: a watch with no
              model name is headed by its reference already. */}
          {item.modelName && (
            <p className="text-caption tabular-nums text-content-secondary">{item.model}</p>
          )}
          {facts.length > 0 && (
            <p className="mt-1 text-caption text-content-secondary">{facts.join(' · ')}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {condition && <Chip tone="neutral">{condition}</Chip>}
            {set && <Chip tone="neutral">{set}</Chip>}
          </div>

          {/*
            Trade first and set larger, because it is the number this reader
            is here for; retail sits under it as the context that makes it
            mean something. "On request" rather than a blank, so an unpriced
            piece reads as an invitation rather than an omission.
          */}
          <dl className="mt-auto space-y-1 border-t border-line-subtle pt-3">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-caption font-semibold text-content-secondary">Trade</dt>
              <dd className="text-body font-bold tabular-nums text-content-primary">
                {item.trade === null
                  ? <span className="font-normal text-content-secondary">On request</span>
                  : formatCurrency(item.trade, currency, { decimals: false })}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-caption text-content-secondary">Retail</dt>
              <dd className="text-caption tabular-nums text-content-secondary">
                {item.retail === null
                  ? 'On request'
                  : formatCurrency(item.retail, currency, { decimals: false })}
              </dd>
            </div>
          </dl>
        </div>
      </Card>
    </li>
  )
}

function ViewButton({ active, onClick, icon, label }: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`${label} view`}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-caption font-semibold transition-colors',
        active
          ? 'bg-surface-subtle text-content-primary'
          : 'text-content-secondary hover:text-content-primary',
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

/**
 * The same stock, priced in a column.
 *
 * A photograph each, kept small: without one every row is a reference number
 * and a dealer scanning thirty of them has to open each to know what it is.
 */
function CatalogueTable({ items, currency }: { items: CatalogueItem[]; currency: CurrencyCode }) {
  return (
    <Card>
      <Table>
        <THead>
          <TR>
            <TH width="64px"><span className="sr-only">Photograph</span></TH>
            <TH>Piece</TH>
            <TH width="130px">Reference</TH>
            <TH width="80px">Year</TH>
            <TH width="130px">Accompanied by</TH>
            <TH width="110px">Condition</TH>
            <TH width="120px" align="right">Trade</TH>
            <TH width="120px" align="right">Retail</TH>
          </TR>
        </THead>
        <TBody>
          {items.map((item) => {
            const condition = item.condition === 'UNKNOWN' ? null : CONDITION_LABELS[item.condition as Condition]
            const set = item.boxPapers === 'UNKNOWN' ? null : BOX_PAPERS_LABELS[item.boxPapers as BoxPapers]
            return (
              <TR key={item.id}>
                <TD>
                  <div className="h-11 w-11 overflow-hidden rounded-sm bg-surface-subtle">
                    {item.imageId && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={`/api/images/${item.imageId}`}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-contain p-1"
                      />
                    )}
                  </div>
                </TD>
                <TD>
                  <span className="block font-bold text-content-primary">{item.modelName ?? item.model}</span>
                  <span className="block text-caption text-content-secondary">{item.brandName}</span>
                </TD>
                <TD className="tabular-nums text-content-secondary">{item.model}</TD>
                <TD className="tabular-nums text-content-secondary">{item.year ?? '—'}</TD>
                <TD className="text-content-secondary">{set ?? '—'}</TD>
                <TD className="text-content-secondary">{condition ?? '—'}</TD>
                <TD align="right" className="font-bold tabular-nums">
                  {item.trade === null
                    ? <span className="font-normal text-content-secondary">On request</span>
                    : formatCurrency(item.trade, currency, { decimals: false })}
                </TD>
                <TD align="right" className="tabular-nums text-content-secondary">
                  {item.retail === null ? 'On request' : formatCurrency(item.retail, currency, { decimals: false })}
                </TD>
              </TR>
            )
          })}
        </TBody>
      </Table>
    </Card>
  )
}
