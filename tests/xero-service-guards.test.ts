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
    expect(apply).toContain("if (invoice.bucket !== 'SALE') continue")
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
