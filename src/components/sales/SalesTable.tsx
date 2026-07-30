'use client'
import Link from 'next/link'
import { useMemo } from 'react'
import { cn } from '@/lib/cn'
import { useListQuery } from '@/hooks/useListQuery'
import { Table, THead, TBody, TR, TD, TH, Pagination, Chip } from '@/components/ui'
import { formatPct } from '@/lib/money'
import { useCurrency } from '@/components/ui'
import { formatDate } from '@/lib/dates'
import { SALE_CHANNEL_LABELS } from '@/lib/enums'
import type { SaleListItem } from '@/server/repositories/sale-repository'

export function SalesTable({ result, showCost = true }: {
  result: { items: SaleListItem[]; total: number; page: number; perPage: number }
  /**
   * Whether the cost side — cost, profit, margin — exists on this table.
   * The page has already nulled the figures for roles without `cost:read`;
   * this removes the columns so the headers do not advertise data that will
   * never arrive.
   */
  showCost?: boolean
}) {
  const query = useListQuery()
  // Money renders in whatever currency the header is showing, so the table
  // never disagrees with the summary tiles above it.
  const { money, signed } = useCurrency()
  const sort = useMemo(
    () => ({ field: query.get('sort') ?? 'saleDate', dir: (query.get('dir') ?? 'desc') as 'asc' | 'desc' }),
    [query],
  )

  return (
    <div className={cn('transition-opacity', query.isPending && 'opacity-60')} aria-busy={query.isPending}>
      <Table>
        <THead>
          <TR>
            <TH width="110px" sortKey="saleDate" sort={sort} onSort={query.sortBy}>Sale date</TH>
            <TH width="130px">Invoice</TH>
            <TH width="80px" sortKey="stockNo" sort={sort} onSort={query.sortBy}>Stock</TH>
            <TH>Watch</TH>
            <TH width="120px">Customer</TH>
            <TH width="100px">Channel</TH>
            {showCost && <TH width="110px" align="right">Cost</TH>}
            <TH width="110px" align="right" sortKey="amount" sort={sort} onSort={query.sortBy}>Sale</TH>
            {showCost && <TH width="110px" align="right" sortKey="profit" sort={sort} onSort={query.sortBy}>Profit</TH>}
            {showCost && <TH width="140px" align="right" sortKey="margin" sort={sort} onSort={query.sortBy}>Margin</TH>}
          </TR>
        </THead>
        <TBody>
          {result.items.map((sale) => (
            <TR key={sale.id}>
              <TD className="text-content-secondary">{formatDate(sale.saleDate)}</TD>
              <TD className="font-bold text-navy-700">{sale.invoiceNo}</TD>
              <TD className="text-content-secondary">{sale.stockNo}</TD>
              <TD>
                <Link href={`/inventory/${sale.watchId}`} className="block hover:underline">
                  <span className="block font-bold text-content-primary">{sale.model}</span>
                  <span className="block text-caption text-content-secondary">{sale.brandName}</span>
                </Link>
              </TD>
              <TD className="text-content-secondary">{sale.customerName ?? '—'}</TD>
              <TD>
                <Chip tone="neutral">{SALE_CHANNEL_LABELS[sale.channel]}</Chip>
              </TD>
              {showCost && <TD align="right" className="text-content-secondary">{money(sale.costGbp)}</TD>}
              <TD align="right" className="font-bold">{money(sale.amountGbp)}</TD>
              {showCost && (
              <>
              <TD align="right" className={cn('font-bold', sale.profitGbp >= 0 ? 'text-content-accent' : 'text-state-danger')}>
                {signed(sale.profitGbp)}
              </TD>
              <TD align="right">
                <span className={cn('font-bold', sale.marginBps >= 0 ? 'text-content-primary' : 'text-state-danger')}>
                  {formatPct(sale.marginBps / 100)}
                </span>
                {sale.vsEstimateGbp !== null && sale.vsEstimateGbp !== 0 && (
                  // On one line: "vs est." wrapping alone under the figure read
                  // as a second, unrelated number.
                  <span className="block whitespace-nowrap text-micro text-content-secondary">
                    {sale.vsEstimateGbp > 0 ? '↑' : '↓'} {money(Math.abs(sale.vsEstimateGbp))} vs est.
                  </span>
                )}
              </TD>
              </>
              )}
            </TR>
          ))}
        </TBody>
      </Table>

      <Pagination
        page={result.page}
        perPage={result.perPage}
        total={result.total}
        noun="sale"
        onPage={(page) => query.set('page', String(page))}
        onPerPage={(perPage) => query.set('perPage', String(perPage))}
      />
    </div>
  )
}
