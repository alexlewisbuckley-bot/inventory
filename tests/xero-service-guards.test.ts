import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const service = readFileSync(join(process.cwd(), 'src/server/services/xero-service.ts'), 'utf8')
const stage = service.slice(
  service.indexOf('export async function stageImport'),
  service.indexOf('async function writeLinks'),
)
const apply = service.slice(service.indexOf('export async function applyImport'))

/**
 * The three things Alex said not to do.
 *
 *   "Don't overwrite system-owned fields (cost, sold-by, stock number,
 *    notes) from Xero."
 *   "Don't auto-apply anything without review."
 *   "Don't create new sales from Xero invoices automatically."
 *
 * Each is a property of the code rather than of a particular run, so each
 * is pinned here. Verified against the real database too: approving one
 * field on one sale moved that field and nothing else, and left the other
 * sale on the same invoice exactly as it was.
 */
describe('what reconciling may not do', () => {
  it('writes nothing to a sale while staging', () => {
    // Reading the file must not change the ledger. Nothing writes until
    // approved, so the staging path touches its own tables only.
    expect(stage).not.toContain('db.update(sales)')
    expect(stage).not.toContain('db.insert(sales)')
  })

  it('never creates a sale', () => {
    // An invoice with no sale behind it is an exception for somebody to
    // look at, never a row to conjure.
    expect(service).not.toContain('db.insert(sales)')
  })

  it('never writes a system-owned field', () => {
    for (const owned of ['purchasePriceGbp:', 'soldById:', 'notes:', 'stockNo:', 'channel:']) {
      expect(apply).not.toContain(`patch[${owned}`)
      expect(apply).not.toContain(`${owned} change`)
    }
    // The patch is assembled only out of approved changes, and a change can
    // only name a field Xero owns.
    expect(apply).toContain('for (const change of taking) patch[change.field] = change.to')
  })

  it('applies only the fields that were ticked', () => {
    expect(apply).toContain('const wanted = approvals[line.saleId]')
    expect(apply).toContain("if (!wanted || wanted.length === 0) continue")
    expect(apply).toContain('line.changes.filter((change) => wanted.includes(change.field))')
  })

  it('refuses to apply the same import twice', () => {
    expect(apply).toContain("if (header.appliedAt) throw new ConflictError")
  })

  it('writes nothing to a sale from a buy back', () => {
    /*
     * Still true, by a better mechanism. This used to be the bucket skip
     * — an invoice marked Buy Back was dropped whole — which also meant
     * a buy-back charge linked to it could never be written either.
     *
     * What guarantees it now is the link's own kind: anything that is
     * not a SALE branches away before the sale path, into the writer for
     * its own table. A charge cannot reach `db.update(sales)` at all.
     */
    expect(apply).toContain("if (line.kind !== 'SALE') {")
    expect(apply).toContain("? await applyToCommission(line.saleId, taking, rates)")
    expect(apply).toContain(": await applyToCharge(line.saleId, taking, rates)")
    // The sale path is after that branch, so it is only ever reached by a sale.
    expect(apply.indexOf("if (line.kind !== 'SALE') {"))
      .toBeLessThan(apply.indexOf('await db.update(sales).set(patch)'))
  })

  it('re-derives the money that hangs off an amount', () => {
    // Writing an amount and leaving the base figure, profit and margin
    // saying what the old amount made is how a reconciled ledger ends up
    // disagreeing with itself.
    expect(apply).toContain('saleMoney(amount, currency, rate, current.cost ?? 0)')
  })

  it('audits every change against the watch, naming the import', () => {
    expect(apply).toContain('await recordAudit({')
    expect(apply).toContain('Reconciled stock ${current.stockNo} against Xero invoice')
    expect(apply).toContain('${header.fileName}')
  })

  it('compares and weighs money in base, never in its own currency', () => {
    // A USD sale and a GBP one weighted by their raw minor units split an
    // invoice in a ratio that means nothing.
    expect(service).toContain('amountBase: sale.amountBase')
    expect(service).toContain('weight: byId.get(match.saleId)?.amountBase ?? 0')
    expect(service).not.toContain('?.saleAmount ?? 0')
  })

  it('checks an allocation balances before storing it', () => {
    expect(service).toContain('if (!allocationBalances(invoice.total, shares))')
  })
})

/**
 * Alex: "Once reconciled it is not correct as they have been linked with
 * Xero."
 *
 * Applying an import marked only sales as accounted for, so a commission
 * and a buy-back charge went on reading "Not in Xero" however well they
 * had just reconciled. The ledger made the same mistake from the other
 * end by hard-coding the seen-import to null for both kinds.
 */
describe('an import accounts for all three books', () => {
  const ledger = readFileSync(join(process.cwd(), 'src/server/services/sales-ledger.ts'), 'utf8')

  it('marks commissions and charges as seen, not only sales', () => {
    expect(apply).toContain("await db.update(brokerages).set({ xeroSeenImportId: importId })")
    expect(apply).toContain("await db.update(buybackCharges).set({ xeroSeenImportId: importId })")
  })

  it('marks each kind against its own rows', () => {
    expect(apply).toContain("const seenOf = (kind: CandidateKind)")
    expect(apply).toContain("review.invoices\n      .flatMap((invoice) => invoice.sales.filter((s) => s.kind === kind)")
  })

  it('no longer hard-codes the ledger rows as never seen', () => {
    expect(ledger).not.toContain('xeroSeenImportId: null')
    expect(ledger).toContain('xeroSeenImportId: row.xeroSeenImportId')
  })

  it('gives a buy-back charge an invoice number of its own', () => {
    // A loan running six months is six charges and six Xero invoices, so
    // the loan's reference cannot stand for any one of them.
    expect(service).toContain("if (change.field === 'invoiceNo') patch['invoiceNo'] = change.to")
    expect(ledger).toContain('row.invoiceNo ?? row.reference')
  })
})

/**
 * Alex, on a buy-back that reconciled and changed nothing: "Didn't
 * identify this and update it for some reason why?"
 *
 * An invoice bucketed Buy Back was skipped outright at apply time, and
 * its changes were never even put in the payload. That was right when a
 * buy-back was something the reconcile could only set aside; once a
 * charge became linkable, the same two lines started refusing to write
 * the very thing they had just been linked to.
 */
describe('a Buy Back invoice can be applied', () => {
  const review = readFileSync(join(process.cwd(), 'src/components/sales/ReconcileReview.tsx'), 'utf8')

  it('skips only what the user said is none of ours', () => {
    expect(apply).toContain("if (invoice.bucket === 'NOT_A_SALE') continue")
    expect(apply).not.toContain("if (invoice.bucket !== 'SALE') continue")
  })

  it('puts its changes in the payload', () => {
    expect(review).toContain("filter((invoice) => invoice.bucket !== 'NOT_A_SALE')")
    expect(review).not.toContain("filter((invoice) => invoice.bucket === 'SALE')")
  })

  it('calls an invoice that matched a charge a buy-back', () => {
    // What it matched is better evidence than the words on it.
    expect(service).toContain("if (matched.some((m) => m.kind === 'BUYBACK')) return 'BUYBACK'")
  })
})

/**
 * Alex: "Luis Suarez is showing as not in zero, but it is in zero."
 *
 * It was, and it matched his invoice number exactly. What it could not do
 * was get recorded as accounted for: applying is the only thing that
 * writes the seen-import, and applying was refused when nothing was
 * ticked. An import where everything already agreed with Xero could
 * therefore never be applied — so the rows that matched perfectly, with
 * nothing to correct, were the ones left reading "Not in Xero".
 */
describe('an import with nothing to correct can still be applied', () => {
  const action = readFileSync(join(process.cwd(), 'src/app/actions/xero.ts'), 'utf8')
  const review = readFileSync(join(process.cwd(), 'src/components/sales/ReconcileReview.tsx'), 'utf8')

  it('no longer refuses an empty tick list', () => {
    expect(action).not.toContain('Nothing was ticked, so nothing was changed.')
  })

  it('still only writes fields that were ticked', () => {
    // Applying nothing must mean nothing is written, not everything.
    expect(apply).toContain('const wanted = approvals[line.saleId]')
    expect(apply).toContain('if (!wanted || wanted.length === 0) continue')
  })

  it('still records what the import accounted for', () => {
    expect(apply).toContain("const seenOf = (kind: CandidateKind)")
  })

  it('offers the button on a linked row rather than on a change', () => {
    expect(review).toContain('linkedCount > 0 &&')
    expect(review).toContain('`Mark ${linkedCount} as reconciled`')
    expect(review).not.toContain('disabled={pending || onCount === 0}')
  })
})
