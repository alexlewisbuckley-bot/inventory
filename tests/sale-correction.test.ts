import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { saleAmendSchema, fieldErrors } from '@/lib/validation'
import { can } from '@/lib/permissions'

/**
 * Correcting a sale that has already been booked.
 *
 * The invoice number is typed by hand with a customer in the room, and it
 * then goes on a piece of paper they keep. It gets mistyped. The only remedy
 * was to void the sale and book it again — which discards the row their
 * invoice points at, orphans the activity written on to their timeline, and
 * leaves the ledger carrying two entries for one watch leaving the building.
 * So nobody did it, and the ledger kept the typo.
 *
 * `sale:update` had been declared in the capability list since the beginning
 * and granted to Managers and Owners, and nothing in the codebase asked for
 * it. This is the thing it was declared for.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

const complete = {
  id: 'sal_1',
  invoiceNo: 'INV-2026-014',
  saleDate: '2026-09-02',
  saleAmount: '15,250',
  saleCurrency: 'USD',
  channel: 'RETAIL',
  paymentStatus: 'PAID',
  deliveryStatus: 'COLLECTED',
}

describe('what may be corrected', () => {
  it('accepts a correction with a grouped amount', () => {
    // The money field groups thousands as they are typed and the modal sends
    // the string as it stands, so "15,250" has to survive the schema.
    const result = saleAmendSchema.safeParse(complete)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.saleAmount).toBe(15250)
  })

  it('still insists on an invoice number', () => {
    const result = saleAmendSchema.safeParse({ ...complete, invoiceNo: '  ' })
    expect(result.success).toBe(false)
    if (!result.success) expect(fieldErrors(result.error).invoiceNo).toMatch(/required/i)
  })

  it('refuses a sale date in the future', () => {
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    const result = saleAmendSchema.safeParse({ ...complete, saleDate: future })
    expect(result.success).toBe(false)
    if (!result.success) expect(fieldErrors(result.error).saleDate).toMatch(/future/i)
  })

  it('will not re-point the sale at another watch or another buyer', () => {
    // Those are not typos, they are a different sale, and a void is the
    // honest way to say so. Zod strips unknown keys rather than rejecting
    // them, so the assertion is that they do not survive into the patch.
    const result = saleAmendSchema.safeParse({
      ...complete, watchId: 'wat_other', customerId: 'cus_other', dealId: 'del_other',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty('watchId')
      expect(result.data).not.toHaveProperty('customerId')
      expect(result.data).not.toHaveProperty('dealId')
    }
  })

  it('leaves the buyer’s contact details to the customer book', () => {
    // A second editable copy of a phone number is how two copies come to
    // disagree, and the customer record is already editable.
    const schema = read('src/lib/validation.ts')
    const block = schema.slice(schema.indexOf('export const saleAmendSchema'))
    const body = block.slice(0, block.indexOf('export type SaleAmendInput'))
    expect(body).not.toMatch(/customerEmail|customerPhone|customerCountry/)
  })
})

describe('who may correct one', () => {
  it('is the Owner, and the Manager who could already void it', () => {
    // Both hold `sale:delete` — the power to void the sale outright and book
    // it again. Withholding the lesser, non-destructive version of the same
    // correction would only push them towards the destructive one.
    expect(can('OWNER', 'sale:update')).toBe(true)
    expect(can('MANAGER', 'sale:update')).toBe(true)
    for (const role of ['STAFF', 'SALES', 'OPERATIONS', 'VIEWER', 'TRADER'] as const) {
      expect(can(role, 'sale:update'), role).toBe(false)
    }
  })

  it('is asked for at the action, not only in the markup', () => {
    const action = read('src/app/actions/watches.ts')
    const amend = action.slice(action.indexOf('export async function amendSaleAction'))
    expect(amend.slice(0, 400)).toMatch(/requireCapability\('sale:update'\)/)
  })

  it('decides whether the button is there at all', () => {
    expect(read('src/app/(app)/sales/page.tsx')).toMatch(/canAmend=\{can\(user\.role, 'sale:update'\)\}/)
  })
})

describe('where it is reached from', () => {
  const table = read('src/components/sales/SalesTable.tsx')

  it('is one menu on the row, not a row of buttons', () => {
    // Two labelled buttons side by side pushed this table past the width of
    // a laptop, which put Void — the destructive one — off the right-hand
    // edge behind a sideways scroll, with the date column clipped at the
    // other end. The stock list already keeps its row actions behind a
    // single control.
    expect(table).toMatch(/<AnchoredMenu/)
    expect(table).toMatch(/label: 'Correct this sale…'/)
    expect(table).toMatch(/label: 'Void the sale…'/)
    // And the table was narrowed by the slack the buttons used to need.
    expect(table).toMatch(/\(showCost \? 1170 : 820\) \+ 56/)
  })

  it('offers no trigger at all to a reader who may do neither', () => {
    // A menu that opens on nothing is worse than no menu.
    const actions = table.slice(table.indexOf('function RowActions'))
    expect(actions).toMatch(/if \(items\.length === 0\) return null/)
  })

  it('opens on the figure as it was agreed, in the currency it was agreed in', () => {
    // Converting it to the display currency and back would show a sale
    // struck at 55,000 dirhams as its dollar equivalent, and saving that
    // would restate the sale at whatever today's rate makes of it.
    const modal = read('src/components/sales/EditSaleModal.tsx')
    expect(modal).toMatch(/target\.saleAmount \?\? target\.amountGbp/)
    expect(modal).toMatch(/setCurrency\(target\.saleAmount === null \? BASE_CURRENCY : target\.saleCurrency\)/)
  })
})

describe('the figures a correction leaves behind', () => {
  const service = read('src/server/services/watch-service.ts')

  it('are worked out in one place, shared with the booking', () => {
    // Four stored columns and a margin all derive from two numbers, and every
    // one of them is read by a report. Two copies of the arithmetic is how
    // three get recomputed and the fourth keeps the figure it was booked
    // with.
    expect(service).toMatch(/function saleMoney\(/)
    const booking = service.slice(service.indexOf('export async function recordSale'))
    expect(booking.slice(0, 4000)).toMatch(/saleMoney\(/)
    const amend = service.slice(service.indexOf('export async function amendSale'))
    expect(amend.slice(0, 9000)).toMatch(/saleMoney\(/)
  })

  it('keep the rate the sale was booked at', () => {
    // A sale agreed in dirhams six months ago has a base figure derived from
    // the rate that applied then. Re-deriving it from today's table would
    // move the recorded revenue by however much the rate has drifted — as a
    // side effect of fixing a typo in an invoice number.
    const amend = service.slice(service.indexOf('export async function amendSale'))
    expect(amend.slice(0, 9000)).toMatch(
      /input\.saleCurrency === sale\.saleCurrency && sale\.saleFxRate\s*\n?\s*\?\s*sale\.saleFxRate/,
    )
  })

  it('refuse to rewrite a voided invoice', () => {
    // A voided invoice records something that was cancelled. Editing it would
    // rewrite history rather than correct it, and the sale that replaced it
    // is the row that wants correcting.
    const amend = service.slice(service.indexOf('export async function amendSale'))
    expect(amend.slice(0, 9000)).toMatch(/if \(sale\.voidedAt\)/)
  })

  it('let a sale keep its own invoice number', () => {
    // The uniqueness check has to exclude the row being saved, or saving a
    // sale without touching its number collides with itself.
    const amend = service.slice(service.indexOf('export async function amendSale'))
    expect(amend.slice(0, 9000)).toMatch(/duplicate\[0\]\.id !== sale\.id/)
  })

  it('reach the sale when it is the cost that was corrected', () => {
    // Profit and margin are stored against the sale so reports can total
    // them without joining back to stock. That goes stale the moment a cost
    // is corrected after the watch has gone: the ledger keeps reporting the
    // profit it was booked with and the stock record disagrees with it for
    // good.
    const update = service.slice(service.indexOf('export async function updateWatch'))
    const body = update.slice(0, update.indexOf('export async function', 1))
    expect(body).toMatch(/patch\.purchasePriceGbp !== existing\.purchasePriceGbp/)
    expect(body).toMatch(/db\.update\(sales\)\.set\(\{\s*\n\s*profitGbp/)
  })
})

describe('the cost, which is the stock record’s figure', () => {
  const service = read('src/server/services/watch-service.ts')
  const amend = service.slice(service.indexOf('export async function amendSale'))

  it('is correctable from the row that prints it beside the profit', () => {
    // Cost, sale, profit and margin sit side by side on the ledger. Somebody
    // looking at a margin they do not believe is looking at those numbers
    // together, and sending them to another screen to fix one of them is how
    // the margin stays wrong.
    expect(read('src/lib/validation.ts')).toMatch(/purchaseAmount: z\.union\(\[money\('Cost'\)/)
    expect(read('src/components/sales/EditSaleModal.tsx')).toMatch(/label="Cost"/)
  })

  it('stays the owner’s to change, even reached from here', () => {
    // `sale:update` is a Manager's. The cost is the figure the business is
    // valued on, and the stock list keeps it behind `watch:amend`, which is
    // the owner's alone. Reaching it through the invoice screen would be the
    // same power through a side door.
    expect(can('MANAGER', 'sale:update')).toBe(true)
    expect(can('MANAGER', 'watch:amend')).toBe(false)
    expect(can('OWNER', 'watch:amend')).toBe(true)
    expect(amend.slice(0, 9000)).toMatch(/if \(!can\(actor\.role, 'watch:amend'\)\) \{\n\s+throw new ForbiddenError/)
    // And the field is not rendered for them either, so the dialog cannot
    // send back a figure it never showed.
    expect(read('src/components/sales/SalesTable.tsx')).toMatch(/canAmendCost=\{canAmendCost\}/)
    expect(read('src/app/(app)/sales/page.tsx')).toMatch(/canAmendCost=\{can\(user\.role, 'watch:amend'\)\}/)
  })

  it('is left alone by a correction that does not mention it', () => {
    // Otherwise a form without the field would blank the cost of every watch
    // whose invoice anybody tidied up.
    expect(amend.slice(0, 9000)).toMatch(/if \(input\.purchaseAmount !== null && input\.purchaseAmount !== undefined\)/)
  })

  it('keeps the rate the watch was bought at', () => {
    // The same reason the sale keeps the rate it was sold at: a cost agreed
    // in dirhams should not move because the rate has since drifted.
    expect(amend.slice(0, 9000)).toMatch(/currency === watch\.purchaseCurrency && watch\.purchaseFxRate/)
  })

  it('is what the profit is then worked out from', () => {
    // Not the figure the sale was booked against. Closing the dialog on a
    // corrected cost and a stale profit would leave the row disagreeing with
    // itself in plain sight.
    expect(amend.slice(0, 9000)).toMatch(/saleMoney\(.*input\.saleCurrency, rate, costBase\)/)
  })
})

describe('what the correction leaves on the record', () => {
  it('is the old value next to the new one', () => {
    const service = read('src/server/services/watch-service.ts')
    const amend = service.slice(service.indexOf('export async function amendSale'))
    const body = amend.slice(0, 9000)
    expect(body).toMatch(/diff\(sale, patch, \[/)
    for (const field of ['invoiceNo', 'saleDate', 'saleAmountGbp', 'profitGbp']) {
      expect(body, field).toMatch(new RegExp(`'${field}'`))
    }
    // Against the watch, which is where the history of a piece is read. A
    // sale has no page of its own to put a trail on.
    expect(body).toMatch(/entityType: 'Watch', entityId: watch\.id/)
  })

  it('reads as money and as a date rather than as columns', () => {
    const format = read('src/lib/audit-format.ts')
    expect(format).toMatch(/invoiceNo: 'Invoice number'/)
    expect(format).toMatch(/saleAmountGbp: 'Sale price'/)
    expect(format).toMatch(/'saleAmountGbp', 'salePriceGbp', 'profitGbp'/)
  })
})
