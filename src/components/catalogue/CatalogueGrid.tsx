'use client'
import { PackageSearch, Search, X } from 'lucide-react'
import { useListQuery } from '@/hooks/useListQuery'
import { Card, EmptyState, Pagination, Chip } from '@/components/ui'
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
  const filtering = Boolean(brand || q || quotedOnly)

  return (
    <div className={cn('transition-opacity', query.isPending && 'opacity-60')} aria-busy={query.isPending}>
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <label className="relative min-w-[220px] flex-1">
            <span className="sr-only">Search the catalogue</span>
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
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {result.items.map((item) => <Tile key={item.id} item={item} currency={currency} />)}
        </ul>
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
        <div className="aspect-[4/3] w-full bg-surface-subtle">
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
