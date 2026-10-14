'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState } from 'react'
import { MoreHorizontal, Pencil, Undo2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useListQuery } from '@/hooks/useListQuery'
import {
  Table, THead, TBody, TR, TD, TH, Pagination, Chip, IconButton, AnchoredMenu, type MenuItem,
} from '@/components/ui'
import { VoidSaleModal, type VoidTarget } from '@/components/inventory/VoidSaleModal'
import { EditSaleModal, type EditSaleTarget } from '@/components/sales/EditSaleModal'
import { formatPct } from '@/lib/money'
import { useCurrency } from '@/components/ui'
import { formatDate } from '@/lib/dates'
import { SALE_CHANNEL_LABELS } from '@/lib/enums'
import type { SaleListItem } from '@/server/repositories/sale-repository'

export function SalesTable({
  result, showCost = true, canVoid = false, canAmend = false, canAmendCost = false,
  salesPeople = [],
}: {
  result: { items: SaleListItem[]; total: number; page: number; perPage: number }
  /**
   * Whether the cost side — cost, profit, margin — exists on this table.
   * The page has already nulled the figures for roles without `cost:read`;
   * this removes the columns so the headers do not advertise data that will
   * never arrive.
   */
  showCost?: boolean
  /**
   * Whether this reader may reverse a sale.
   *
   * Voiding was reachable only from the inventory list, where a sold watch
   * still appears. Somebody who had just booked a sale wrongly went looking
   * for it on the page listing sales, found nothing, and had no way to undo
   * it. The action belongs on both: this is the page the mistake is visible
   * from.
   */
  canVoid?: boolean
  /**
   * Whether this reader may correct a booked sale.
   *
   * An invoice number is typed by hand with a customer waiting and then
   * printed on something they keep. The only remedy for a typo was to void
   * the sale and book it again, which discards the row their invoice points
   * at — so people left it wrong instead.
   */
  canAmend?: boolean
  /**
   * Whether this reader may restate what a watch cost, which is a stricter
   * question than whether they may correct the invoice. The stock list keeps
   * that figure behind the owner's own capability; reaching it through the
   * sales page would be the same power by another door.
   */
  canAmendCost?: boolean
  /** Who may be credited with a sale, for the correction dialog. */
  salesPeople?: Array<{ id: string; name: string }>
}) {
  const query = useListQuery()
  const router = useRouter()
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null)
  const [editTarget, setEditTarget] = useState<EditSaleTarget | null>(null)
  // Money renders in whatever currency the header is showing, so the table
  // never disagrees with the summary tiles above it.
  const { money, signed } = useCurrency()
  const sort = useMemo(
    () => ({ field: query.get('sort') ?? 'saleDate', dir: (query.get('dir') ?? 'desc') as 'asc' | 'desc' }),
    [query],
  )

  return (
    <div className={cn('transition-opacity', query.isPending && 'opacity-60')} aria-busy={query.isPending}>
      {/* Fixed, so the stated widths hold rather than being redistributed by
          content — see the note on the Table component. */}
      <Table
        layout="fixed"
        // The stated column widths, plus room for the actions control. This
        // carried 200px of slack for a labelled Void button, which put the
        // table past the width of a laptop and left the date column clipped
        // behind a sideways scroll. A menu needs a quarter of that.
        minWidth={`${(showCost ? 1184 : 834) + 110 + 56}px`}
      >
        <THead>
          <TR>
            <TH width="124px" sortKey="saleDate" sort={sort} onSort={query.sortBy}>Sale date</TH>
            <TH width="124px">Invoice</TH>
            <TH width="80px" sortKey="stockNo" sort={sort} onSort={query.sortBy}>Stock</TH>
            {/* Sized like the inventory list, which shows the same reference
                and brand: measured at 171px for the longest in stock. */}
            <TH width="176px">Watch</TH>
            <TH width="120px">Customer</TH>
            <TH width="110px">Sold by</TH>
            <TH width="100px">Channel</TH>
            {showCost && <TH width="110px" align="right">Cost</TH>}
            <TH width="110px" align="right" sortKey="amount" sort={sort} onSort={query.sortBy}>Sale</TH>
            {showCost && <TH width="110px" align="right" sortKey="profit" sort={sort} onSort={query.sortBy}>Profit</TH>}
            {showCost && <TH width="130px" align="right" sortKey="margin" sort={sort} onSort={query.sortBy}>Margin</TH>}
            {/* Always present, and the one column without a width, so it
                takes whatever is left over. The watch used to be elastic, and
                on a wide screen that put a hand's width of empty table
                between a reference and the customer who bought it. The slack
                belongs at the end of the row, behind right-aligned contents,
                where it reads as the row finishing. */}
            <TH align="right"><span className="sr-only">Actions</span></TH>
          </TR>
        </THead>
        <TBody>
          {result.items.map((sale) => (
            <TR key={sale.id}>
              <TD className="whitespace-nowrap text-content-secondary">{formatDate(sale.saleDate)}</TD>
              <TD className="font-bold text-navy-700">{sale.invoiceNo}</TD>
              <TD className="text-content-secondary">{sale.stockNo}</TD>
              <TD>
                <Link href={`/inventory/${sale.watchId}`} className="block hover:underline">
                  <span className="block font-bold text-content-primary">{sale.model}</span>
                  <span className="block text-caption text-content-secondary">{sale.brandName}</span>
                </Link>
              </TD>
              <TD className="text-content-secondary">{sale.customerName ?? '—'}</TD>
              {/* "Not recorded" rather than a dash: a blank here is a fact
                  about every sale booked before the list existed, and it is
                  worth distinguishing from a customer nobody captured. */}
              <TD className={cn(!sale.soldByName && 'text-content-muted')}>
                {sale.soldByName ?? 'Not recorded'}
              </TD>
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
              <TD align="right">
                <RowActions
                  sale={sale}
                  canAmend={canAmend}
                  canVoid={canVoid}
                  onCorrect={() => setEditTarget({
                    id: sale.id,
                    invoiceNo: sale.invoiceNo,
                    saleDate: sale.saleDate,
                    saleAmount: sale.saleAmount,
                    saleCurrency: sale.saleCurrency,
                    amountGbp: sale.amountGbp,
                    channel: sale.channel,
                    paymentStatus: sale.paymentStatus,
                    deliveryStatus: sale.deliveryStatus,
                    customerName: sale.customerName,
                    customerCompany: sale.customerCompany,
                    notes: sale.notes,
                    soldById: sale.soldById,
                    purchaseAmount: sale.purchaseAmount,
                    purchaseCurrency: sale.purchaseCurrency,
                    costGbp: sale.costGbp,
                    stockNo: sale.stockNo,
                    label: `${sale.brandName} ${sale.model}`,
                  })}
                  onVoid={() => setVoidTarget({
                    // The watch, not the sale: voiding walks from the watch
                    // to its one live sale, so that is the handle it takes.
                    id: sale.watchId,
                    stockNo: sale.stockNo,
                    label: `${sale.brandName} ${sale.model} · ${sale.invoiceNo}`,
                  })}
                />
              </TD>
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

      <EditSaleModal
        open={editTarget !== null}
        target={editTarget}
        canAmendCost={canAmendCost}
        salesPeople={salesPeople}
        onClose={() => setEditTarget(null)}
        onSaved={() => router.refresh()}
      />

      <VoidSaleModal
        open={voidTarget !== null}
        target={voidTarget}
        onClose={() => setVoidTarget(null)}
        onVoided={() => router.refresh()}
      />
    </div>
  )
}

/**
 * The actions available on one row of the ledger.
 *
 * Correcting a sale arrived as a second labelled button beside Void, and the
 * two together pushed this table wider than the window — which put Void, the
 * destructive one, off the right-hand edge behind a horizontal scroll. The
 * stock list has long kept its row actions behind a single control; this is
 * the same kind of row, so it is the same gesture.
 *
 * Nothing at all is rendered when the reader may do neither, rather than a
 * trigger that opens on an empty menu.
 */
function RowActions({ sale, canAmend, canVoid, onCorrect, onVoid }: {
  sale: SaleListItem
  canAmend: boolean
  canVoid: boolean
  onCorrect: () => void
  onVoid: () => void
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)

  const items: MenuItem[] = [
    ...(canAmend ? [{
      id: 'correct',
      // The ellipsis promises that something will be asked before anything is
      // written, the same promise "Mark as sold…" makes on the stock list.
      label: 'Correct this sale…',
      onSelect: onCorrect,
      icon: <Pencil className="h-3.5 w-3.5" />,
    }] : []),
    ...(canVoid ? [{
      id: 'void',
      label: 'Void the sale…',
      onSelect: onVoid,
      icon: <Undo2 className="h-3.5 w-3.5" />,
      tone: 'danger' as const,
      separated: canAmend,
    }] : []),
  ]

  if (items.length === 0) return null

  const label = `Actions for invoice ${sale.invoiceNo}`
  return (
    <>
      <IconButton
        ref={anchor}
        variant="ghost"
        size="sm"
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        icon={<MoreHorizontal className="h-4 w-4" />}
      />
      <AnchoredMenu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        items={items}
        label={label}
      />
    </>
  )
}
