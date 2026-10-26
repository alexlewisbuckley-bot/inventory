import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { brokerageAmendSchema } from '@/lib/validation'

const service = readFileSync(join(process.cwd(), 'src/server/services/brokerage-service.ts'), 'utf8')
const table = readFileSync(join(process.cwd(), 'src/components/sales/SalesTable.tsx'), 'utf8')

/**
 * A commission could be recorded, linked to a watch, or voided — and nothing
 * else. The reference was therefore fixed at the moment of recording, and an
 * invoice that arrives afterwards, which is the normal way round, had no way
 * onto the record but voiding the commission and typing it again.
 *
 * The sale verbs were deliberately taken off a commission row, and rightly:
 * "Correct this sale" opened a form addressed by an id belonging to another
 * table. What was missing was the commission's own version of that verb.
 */
describe('correcting a commission', () => {
  it('takes an invoice reference on its own', () => {
    const parsed = brokerageAmendSchema.parse({ reference: 'INV-2026-0042' })
    expect(parsed.reference).toBe('INV-2026-0042')
  })

  it('does not default the payment status when the form does not send one', () => {
    // The record schema defaults paymentStatus to PAID. If this one did the
    // same, adding an invoice number to an unpaid fee would quietly mark it
    // paid — a wrong number in the revenue, written by a field nobody
    // touched.
    const parsed = brokerageAmendSchema.parse({ reference: 'INV-1' })
    expect(parsed.paymentStatus).toBeUndefined()
  })

  it('lets a reference typed in error be cleared', () => {
    expect(brokerageAmendSchema.parse({ reference: '' }).reference).toBeNull()
  })

  it('refuses a payment status that is not one of ours', () => {
    expect(() => brokerageAmendSchema.parse({ paymentStatus: 'MAYBE' })).toThrow()
  })

  it('has no way to restate the fee', () => {
    // The fee is what the reports add up, and its base value is derived from
    // the amount, the currency and the rate on the day. Restating income is
    // a void and a re-entry, not a keystroke in a correction dialog.
    const parsed = brokerageAmendSchema.parse({
      reference: 'INV-1', feeAmount: 999999, feeBase: 999999, feeCurrency: 'USD',
    } as never) as Record<string, unknown>
    expect(parsed.feeAmount).toBeUndefined()
    expect(parsed.feeBase).toBeUndefined()
    expect(parsed.feeCurrency).toBeUndefined()
  })

  it('writes only the fields it was given', () => {
    // Every assignment guarded on `!== undefined`, so a form sending one
    // field leaves the rest of the row alone.
    const body = service.slice(service.indexOf('export async function amendBrokerage'))
    for (const field of ['reference', 'soldFor', 'soldTo', 'paymentStatus', 'brokeredOn', 'notes']) {
      expect(body).toContain(`if (input.${field} !== undefined)`)
    }
  })

  it('refuses to correct a commission that was voided', () => {
    // A voided commission is not untidy, it is withdrawn. Putting a
    // corrected invoice number on income nobody is claiming would be worse
    // than leaving it blank.
    const body = service.slice(service.indexOf('export async function amendBrokerage'))
    expect(body).toMatch(/if \(existing\.voidedAt\)[\s\S]{0,160}?ConflictError/)
  })

  it('offers the verb on a commission row', () => {
    expect(table).toMatch(/id: 'correct-commission'/)
    expect(table).toMatch(/onCorrectCommission/)
  })

  it('does not prefill the form with the ledger’s em dash', () => {
    // The ledger prints "—" for a commission with no reference. Loading that
    // into the box would have somebody save an em dash as their invoice
    // number.
    expect(table).toMatch(/sale\.invoiceNo === '—' \? '' : sale\.invoiceNo/)
  })
})

describe('an emptied field and a field never filled', () => {
  it('are the same value in the column', () => {
    // Belt and braces over the schema: a service that trusts every caller to
    // have parsed first is one direct call away from a row whose reference
    // is an empty string, which reads as "recorded, and blank".
    const body = service.slice(service.indexOf('export async function amendBrokerage'))
    expect(body).toMatch(/const blankIsNull =/)
    for (const field of ['reference', 'soldFor', 'soldTo', 'notes']) {
      expect(body).toContain(`patch.${field} = blankIsNull(input.${field})`)
    }
  })

  it('leaves a field that was not sent alone, rather than nulling it', () => {
    // blankIsNull returns undefined for undefined, so "not sent" never
    // becomes "cleared" on its way through.
    const body = service.slice(service.indexOf('const blankIsNull'))
    expect(body).toMatch(/value === undefined \? undefined/)
  })
})
