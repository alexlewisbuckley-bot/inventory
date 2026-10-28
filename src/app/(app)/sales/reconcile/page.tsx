import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { PageHeader } from '@/components/layout/PageHeader'
import { buildReview, recentImports } from '@/server/services/xero-service'
import { ReconcileReview, type ReviewView } from '@/components/sales/ReconcileReview'
import { formatDate } from '@/lib/dates'

export const metadata: Metadata = { title: 'Reconcile with Xero' }
export const dynamic = 'force-dynamic'

/**
 * The sales ledger against the accounts.
 *
 * Alex: "Right now the two drift apart: invoice numbers sit as 'TBA' for
 * days, customer names and dates don't match, payment status is wrong, and
 * when one Xero invoice covers two watches the system shows it as two
 * unrelated lines. We reconciled 14 sales against 12 Xero invoices by hand
 * today and 11 of them had at least one error."
 *
 * The page opens on the last import rather than on an empty drop zone,
 * because the common second visit is to finish something — or to see what
 * an import did after it was applied.
 */
export default async function ReconcilePage({ searchParams }: {
  searchParams: { import?: string }
}) {
  // Reading the comparison is a reporting act; applying it is a correction
  // to the ledger, and the button is gated separately below.
  const user = await requireCapability('data:import')
  const canApply = can(user.role, 'sale:update')

  const imports = await recentImports(1)
  const wanted = searchParams.import ?? imports[0]?.id
  const review = wanted ? await buildReview(wanted) : null

  const view: ReviewView | null = review && {
    importId: review.importId,
    fileName: review.fileName,
    appliedAt: review.appliedAt ? formatDate(review.appliedAt) : null,
    skippedRows: review.skippedRows,
    changeCount: review.changeCount,
    invoices: review.invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      contactName: invoice.contactName,
      invoiceDate: invoice.invoiceDate ? formatDate(invoice.invoiceDate) : null,
      currency: invoice.currency,
      total: invoice.total,
      totalBase: invoice.totalBase,
      fxRate: invoice.fxRate,
      status: invoice.status,
      reference: invoice.reference,
      bucket: invoice.bucket,
      lines: invoice.lines,
      proposedAlias: invoice.proposedAlias,
      looksLikeBuyBack: invoice.looksLikeBuyBack,
      sales: invoice.sales.map((sale) => ({
        saleId: sale.saleId,
        kind: sale.kind,
        label: sale.label,
        stockNo: sale.stockNo,
        tier: sale.tier,
        allocated: sale.allocated,
        changes: sale.changes.map((change) => ({
          field: change.field, fromText: change.fromText, toText: change.toText,
        })),
        exceptions: sale.exceptions.map((issue) => ({ kind: issue.kind, detail: issue.detail })),
      })),
    })),
    unmatchedSales: review.unmatchedSales.map((sale) => ({
      saleId: sale.saleId,
      kind: sale.kind,
      label: sale.label,
      stockNo: sale.stockNo,
      invoiceNo: sale.invoiceNo,
      customerName: sale.customerName,
      saleDate: formatDate(sale.saleDate),
    })),
    exceptions: review.exceptions.map((issue) => ({
      kind: issue.kind, invoiceNo: issue.invoiceNo, stockNo: issue.stockNo, detail: issue.detail,
    })),
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Sales', href: '/sales' }, { label: 'Reconcile with Xero' }]}
        title="Reconcile with Xero"
        description="Xero owns the invoice number, the date, the customer, the amount, the currency and the payment status. Everything else — stock, cost, who sold it, notes — stays as it is here."
      />
      <ReconcileReview review={view} canApply={canApply} />
    </>
  )
}
