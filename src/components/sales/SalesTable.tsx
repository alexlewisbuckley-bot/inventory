'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState } from 'react'
import { BadgeCheck, Handshake, Link2 as LinkIcon, MoreHorizontal, Pencil, Undo2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useListQuery } from '@/hooks/useListQuery'
import {
  Table, THead, TBody, TR, TD, TH, Pagination, Chip, IconButton, AnchoredMenu, useToast,
  type MenuItem,
} from '@/components/ui'
import { VoidSaleModal, type VoidTarget } from '@/components/inventory/VoidSaleModal'
import { EditSaleModal, type EditSaleTarget } from '@/components/sales/EditSaleModal'
import type { LedgerKind } from '@/lib/ledger-kind'
import { stockless } from '@/lib/ledger-kind'
import { flagsFor, flagTone, FLAG_LABELS, type LastImport } from '@/lib/sale-flags'
import { SaleToCommissionModal } from '@/components/sales/SaleToCommissionModal'
import { EditCommissionModal, LinkWatchModal, VoidCommissionModal } from '@/components/sales/CommissionActions'
import { markSalePaidAction } from '@/app/actions/watches'
import { formatPct } from '@/lib/money'
import { useCurrency } from '@/components/ui'
import { formatDate } from '@/lib/dates'
import { PAYMENT_STATUS_LABELS, SALE_CHANNEL_LABELS } from '@/lib/enums'
import type { SaleListItem } from '@/server/repositories/sale-repository'

export function SalesTable({
  result, showCost = true, canVoid = false, canAmend = false, canAmendCost = false,
  salesPeople = [], stock = [], lastImport = null,
}: {
  /**
   * The last Xero import and the period it covered, so a sale inside it
   * that the accounts never saw can say so. Null before the first import,
   * which is when the flag has nothing to say.
   */
  lastImport?: LastImport | null
  result: { items: Array<SaleListItem & { kind?: LedgerKind }>; total: number; page: number; perPage: number }
  /** Stock still on the book, for linking a watch to a commission. */
  stock?: Array<{ id: string; label: string }>
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
  const [commissionTarget, setCommissionTarget] = useState<
    { id: string; label: string; invoiceNo: string; amountGbp: number } | null>(null)
  const [linkTarget, setLinkTarget] = useState<{ id: string; label: string } | null>(null)
  const [editCommissionTarget, setEditCommissionTarget] = useState<
    React.ComponentProps<typeof EditCommissionModal>['target']
  >(null)
  const [voidCommissionTarget, setVoidCommissionTarget] =
    useState<{ id: string; label: string } | null>(null)

  const confirmPaid = async (sale: SaleListItem) => {
    const result = await markSalePaidAction(sale.id)
    if (result.ok) {
      toast.success('Payment recorded', `Invoice ${sale.invoiceNo} is paid in full.`)
      router.refresh()
    } else {
      toast.error('Could not record the payment', result.message)
    }
  }
  /**
   * The flags for one row.
   *
   * Computed here rather than stored, so a flag cannot go stale: filling
   * in a customer clears it because it was never written down.
   */
  const flagsOf = (sale: SaleListItem & { kind?: LedgerKind }) => flagsFor({
    invoiceNo: sale.invoiceNo,
    saleDate: sale.saleDate,
    customerName: sale.customerName,
    stockNo: sale.stockNo ?? null,
    // A role without `cost:read` is handed a nulled cost, which is not the
    // same as a cost of zero. Flagging it would show that reader an error
    // about a figure they cannot see and nobody else can reproduce.
    costGbp: showCost ? sale.costGbp : null,
    channel: sale.channel,
    paymentStatus: sale.paymentStatus,
    dueOn: sale.dueOn,
    xeroSeenImportId: sale.xeroSeenImportId,
    stockless: stockless(sale),
  }, { lastImport })

  // Money renders in whatever currency the header is showing, so the table
  // never disagrees with the summary tiles above it.
  const { money, signed } = useCurrency()
  const toast = useToast()
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
        minWidth={`${(showCost ? 1212 : 862) + 110 + 56}px`}
      >
        <THead>
          <TR>
            <TH width="124px" sortKey="saleDate" sort={sort} onSort={query.sortBy}>Sale date</TH>
            <TH width="152px">Invoice</TH>
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
              <TD className="font-bold text-navy-700">
                {sale.invoiceNo}
                {/* One invoice routinely covers several watches. Saying so
                    here is what stops the row reading like a duplicate —
                    the same number four times down the column, with
                    nothing to say they are four lines of one sale. */}
                {sale.invoiceLines > 1 && (
                  <span className="mt-0.5 block whitespace-nowrap text-caption font-semibold text-content-secondary">
                    {sale.invoiceLines} watches
                  </span>
                )}
                {/* Only when the money is not in. "Paid in full" is the
                    ordinary ending and marking every settled invoice with a
                    badge is how a column of badges stops being read — the
                    flag has to mean something to be worth looking at. */}
                {sale.paymentStatus !== 'PAID' && (
                  <span className={cn(
                    'mt-0.5 block whitespace-nowrap text-caption font-semibold',
                    sale.paymentStatus === 'OVERDUE' ? 'text-state-danger' : 'text-state-warning',
                  )}>
                    {PAYMENT_STATUS_LABELS[sale.paymentStatus]}
                  </span>
                )}
                {/*
                  * What is wrong with this row, on every load rather than
                  * only after an import.
                  *
                  * Alex: "Data-quality flags on the main sales table,
                  * always on, not just at import." A check that runs only
                  * when somebody drops a file tells you about a problem
                  * after it has been one for a week — and the first of
                  * these, an invoice still reading "TBA", is a problem
                  * measured in days.
                  */}
                {flagsOf(sale).map((flag) => {
                  const tone = cn(
                    'mt-0.5 block whitespace-nowrap text-caption font-semibold',
                    flagTone(flag.kind) === 'serious' ? 'text-state-danger' : 'text-state-warning',
                  )
                  /*
                   * "Not in Xero" is the one flag whose answer is on
                   * another page. Saying it here and making somebody go
                   * and find the row is how a flag turns into a question
                   * for whoever built it — the reconcile screen states
                   * which invoice came closest and what kept it out, so
                   * this links straight there.
                   */
                  return flag.kind === 'NOT_IN_XERO' ? (
                    <Link
                      key={flag.kind}
                      href="/sales/reconcile"
                      title={`${flag.detail}. Open the reconcile screen to see which invoice came closest.`}
                      className={cn(tone, 'underline decoration-dotted underline-offset-2')}
                    >
                      {FLAG_LABELS[flag.kind]}
                    </Link>
                  ) : (
                    <span key={flag.kind} title={flag.detail} className={tone}>
                      {FLAG_LABELS[flag.kind]}
                    </span>
                  )
                })}
              </TD>
              {/* A commission has no stock number and no watch to open:
                  the watch was never ours. A dash and plain text rather
                  than a zero and a link to nothing. */}
              <TD className="text-content-secondary">
                {stockless(sale) && !sale.watchId ? '—' : sale.stockNo}
              </TD>
              <TD>
                {/* A fee on one of ours opens its watch like any other row;
                    a fee on somebody else's has no record to open. */}
                {stockless(sale) ? (
                  <div className="flex flex-col items-start gap-1">
                    {sale.watchId ? (
                      <Link href={`/inventory/${sale.watchId}`} className="block hover:underline">
                        <span className="block font-bold text-content-primary">{sale.model}</span>
                        <span className="block text-caption text-content-secondary">{sale.brandName}</span>
                      </Link>
                    ) : (
                      <span className="block font-bold text-content-primary">{sale.model}</span>
                    )}
                  </div>
                ) : (
                  <Link href={`/inventory/${sale.watchId}`} className="block hover:underline">
                    <span className="block font-bold text-content-primary">{sale.model}</span>
                    <span className="block text-caption text-content-secondary">{sale.brandName}</span>
                  </Link>
                )}
              </TD>
              <TD className="text-content-secondary">{sale.customerName ?? '—'}</TD>
              {/* "Not recorded" rather than a dash: a blank here is a fact
                  about every sale booked before the list existed, and it is
                  worth distinguishing from a customer nobody captured. */}
              <TD className={cn(!sale.soldByName && 'text-content-muted')}>
                {sale.soldByName ?? 'Not recorded'}
              </TD>
              <TD>
                {/* Where the commission marker lives, rather than tucked
                    under the watch name: it is an answer to "how did this
                    sell", which is the question this column asks, and a
                    reader scanning the column now sees every brokered deal
                    in one place. Carried in the colour too, because it is
                    the one channel where there is no stock behind the
                    figures in the row. */}
                <Chip tone={sale.channel === 'COMMISSION' ? 'navy' : 'neutral'}>
                  {SALE_CHANNEL_LABELS[sale.channel]}
                </Chip>
              </TD>
              {/* Nothing was bought, so there is no cost — and a margin on
                  no cost is undefined rather than infinite. Both print a
                  dash, which is also what stops them being averaged. */}
              {showCost && (
                <TD align="right" className="text-content-secondary">
                  {stockless(sale) ? '—' : money(sale.costGbp)}
                </TD>
              )}
              <TD align="right" className="font-bold">{money(sale.amountGbp)}</TD>
              {showCost && (
              <>
              <TD align="right" className={cn('font-bold', sale.profitGbp >= 0 ? 'text-content-accent' : 'text-state-danger')}>
                {signed(sale.profitGbp)}
              </TD>
              <TD align="right">
                <span className={cn('font-bold', sale.marginBps >= 0 ? 'text-content-primary' : 'text-state-danger')}>
                  {stockless(sale) ? '—' : formatPct(sale.marginBps / 100)}
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
                  onPaid={() => { void confirmPaid(sale) }}
                  onLink={() => setLinkTarget({ id: sale.id, label: sale.model })}
                  onCorrectCommission={() => setEditCommissionTarget({
                    id: sale.id,
                    label: `${sale.brandName} ${sale.model}`.trim() || sale.model,
                    // The ledger prints an em dash where there is no
                    // reference; the form must offer an empty box, not that.
                    reference: sale.invoiceNo === '—' ? '' : sale.invoiceNo,
                    paymentStatus: sale.paymentStatus,
                    brokeredOn: new Date(sale.saleDate).toISOString().slice(0, 10),
                    notes: sale.notes ?? '',
                    fee: money(sale.amountGbp),
                  })}
                  onOpenLoan={() => router.push('/buybacks')}
                  onCommission={() => setCommissionTarget({
                    id: sale.id,
                    label: `${sale.brandName} ${sale.model}`,
                    invoiceNo: sale.invoiceNo,
                    amountGbp: sale.amountGbp,
                  })}
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

      <LinkWatchModal
        open={linkTarget !== null}
        target={linkTarget}
        stock={stock}
        onClose={() => setLinkTarget(null)}
        onDone={() => router.refresh()}
      />

      <EditCommissionModal
        open={editCommissionTarget !== null}
        target={editCommissionTarget}
        onClose={() => setEditCommissionTarget(null)}
        onDone={() => router.refresh()}
      />

      <VoidCommissionModal
        open={voidCommissionTarget !== null}
        target={voidCommissionTarget}
        onClose={() => setVoidCommissionTarget(null)}
        onDone={() => router.refresh()}
      />

      <SaleToCommissionModal
        open={commissionTarget !== null}
        target={commissionTarget}
        onClose={() => setCommissionTarget(null)}
        onDone={() => router.refresh()}
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
function RowActions({ sale, canAmend, canVoid, onCorrect, onCorrectCommission, onPaid, onVoid, onCommission, onLink, onOpenLoan }: {
  sale: SaleListItem & { kind?: LedgerKind }
  canAmend: boolean
  canVoid: boolean
  onCorrect: () => void
  onPaid: () => void
  onVoid: () => void
  onCommission: () => void
  onLink: () => void
  onCorrectCommission: () => void
  onOpenLoan: () => void
}) {
  /*
   * A commission is not a sale, and none of the sale verbs work on one.
   *
   * They were offered anyway, and "Correct this sale" opened on a
   * commission with Stock 0 and a cost of nothing — a form editing a
   * record that does not exist, addressed by an id belonging to another
   * table. Its own two verbs instead: attach a watch, or void it.
   */
  /*
   * A buy-back charge is not a sale either, and the sale verbs are worse
   * than useless on one: "Correct this sale" would open a form addressed
   * by an id belonging to the charges table, and voiding would reach for
   * a watch that was never ours. The charge is managed on the buy-back it
   * belongs to, where the rest of its months are, so the row offers the
   * two things worth doing from a ledger — record the payment, or go and
   * look at the loan.
   */
  if (sale.kind === 'BUYBACK') {
    const chargeItems: MenuItem[] = [
      ...(canAmend && sale.paymentStatus !== 'PAID' ? [{
        id: 'paid',
        label: 'Payment received',
        onSelect: onPaid,
        icon: <BadgeCheck className="h-3.5 w-3.5" />,
        tone: 'accent' as const,
      }] : []),
      {
        id: 'open',
        label: 'Open the buy-back',
        onSelect: onOpenLoan,
        icon: <LinkIcon className="h-3.5 w-3.5" />,
      },
    ]
    return <RowMenu label={`Actions for ${sale.model}`} items={chargeItems} />
  }

  if (sale.kind === 'COMMISSION') {
    const commissionItems: MenuItem[] = [
      ...(canAmend ? [{
        id: 'correct-commission',
        label: 'Correct this commission…',
        onSelect: onCorrectCommission,
        icon: <Pencil className="h-3.5 w-3.5" />,
      }] : []),
      ...(canAmend ? [{
        id: 'link',
        label: 'Link one of our watches…',
        onSelect: onLink,
        icon: <LinkIcon className="h-3.5 w-3.5" />,
      }] : []),
      ...(canVoid ? [{
        id: 'void-commission',
        label: 'Void this commission…',
        onSelect: onVoid,
        icon: <Undo2 className="h-3.5 w-3.5" />,
        tone: 'danger' as const,
        separated: canAmend,
      }] : []),
    ]
    return commissionItems.length === 0 ? null : (
      <RowMenu label={`Actions for ${sale.model}`} items={commissionItems} />
    )
  }

  const items: MenuItem[] = [
    // First, and without an ellipsis: there is nothing to ask. The money
    // either arrived or it did not, and making somebody confirm a fact they
    // have just asserted is a dialog that teaches people to click through
    // dialogs.
    ...(canAmend && sale.paymentStatus !== 'PAID' ? [{
      id: 'paid',
      label: 'Payment received',
      onSelect: onPaid,
      icon: <BadgeCheck className="h-3.5 w-3.5" />,
      tone: 'accent' as const,
    }] : []),
    ...(canAmend ? [{
      id: 'correct',
      // The ellipsis promises that something will be asked before anything is
      // written, the same promise "Mark as sold…" makes on the stock list.
      label: 'Correct this sale…',
      onSelect: onCorrect,
      icon: <Pencil className="h-3.5 w-3.5" />,
    }] : []),
    /*
     * For a watch that went out for a fee and was booked as a sale,
     * inventing a cost and a margin it never had. Offered beside Void
     * because that is half of what it does, and it saves unpicking the
     * whole thing by hand.
     */
    // No kind check needed: a commission row returned above.
    ...(canVoid ? [{
      id: 'commission',
      label: 'Record as a commission…',
      onSelect: onCommission,
      icon: <Handshake className="h-3.5 w-3.5" />,
      separated: canAmend,
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

  return <RowMenu label={`Actions for invoice ${sale.invoiceNo}`} items={items} />
}

/** The trigger and its menu, so both kinds of row open the same control. */
function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
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
