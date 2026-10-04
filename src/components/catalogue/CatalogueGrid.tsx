'use client'
import { PackageSearch } from 'lucide-react'
import { useListQuery } from '@/hooks/useListQuery'
import { Card, EmptyState, Pagination, Chip, Table, THead, TBody, TR, TD, TH } from '@/components/ui'
import { formatCurrency } from '@/lib/currency'
import { cn } from '@/lib/cn'
import { EnquireButton } from './EnquireButton'
import {
  BOX_PAPERS_LABELS, CONDITION_LABELS,
  type BoxPapers, type Condition, type CurrencyCode,
} from '@/lib/enums'
import type { CataloguePage, CatalogueItem } from '@/server/services/catalogue-service'

export function CatalogueGrid({ result, currency }: {
  result: CataloguePage
  currency: CurrencyCode
}) {
  const query = useListQuery()
  // The controls are in the bar; the state they write is still the URL, so
  // this reads the same values from the same place without owning them.
  const view = query.get('view') === 'table' ? 'table' : 'gallery'
  const filtering = Boolean(query.get('q') || query.get('brand'))

  return (
    <div className={cn('transition-opacity', query.isPending && 'opacity-60')} aria-busy={query.isPending}>
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
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
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
              className="h-full w-full object-contain p-3 sm:p-4"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-caption text-content-muted">
              Photograph to follow
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
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
            {/* Two across on a phone leaves a tile about 150px inside, which
                a six- or seven-figure dirham price and its label do not
                share. So on a phone the figure always sits under the label —
                always, not only when it overflows, or two tiles side by side
                would set their prices at different heights. Wider up, it
                drops under the label only if it has to, and never breaks. */}
            <div className="flex flex-col gap-x-3 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between">
              <dt className="text-caption font-semibold text-content-secondary">Trade</dt>
              <dd className="self-end whitespace-nowrap text-body font-bold tabular-nums text-content-primary sm:ml-auto">
                {item.trade === null
                  ? <span className="font-normal text-content-secondary">On request</span>
                  : formatCurrency(item.trade, currency, { decimals: false })}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <dt className="text-caption text-content-secondary">Retail</dt>
              <dd className="ml-auto whitespace-nowrap text-caption tabular-nums text-content-secondary">
                {item.retail === null
                  ? 'On request'
                  : formatCurrency(item.retail, currency, { decimals: false })}
              </dd>
            </div>
          </dl>

          {/* The one thing a dealer can do here. It opens a conversation
              rather than a deal — whether it becomes one is somebody else's
              decision, and a button that promised otherwise would fill the
              board with other people's intentions. */}
          <div className="mt-3">
            <EnquireButton
              watchId={item.id}
              label={`${item.brandName} ${item.modelName ?? item.model}`}
            />
          </div>
        </div>
      </Card>
    </li>
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
      <Table layout="fixed" minWidth="998px">
        <THead>
          <TR>
            {/* 88px, not 64: the cell's own padding is 40px, so a 64px column left
                24px for a 48px thumbnail. Under the old auto layout the browser
                quietly widened the column to compensate; under `fixed` it is
                taken at its word and the photograph overflowed. */}
            <TH width="88px"><span className="sr-only">Photograph</span></TH>
            {/* elastic: the only column without a width */}
            <TH>Piece</TH>
            <TH width="130px">Reference</TH>
            <TH width="80px">Year</TH>
            <TH width="152px">Accompanied by</TH>
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
