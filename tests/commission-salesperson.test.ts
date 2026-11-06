import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { brokerageAmendSchema } from '@/lib/validation'

const read = (path: string) => readFileSync(path, 'utf8')
const codeOf = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const service = read('src/server/services/brokerage-service.ts')
const ledger = read('src/server/services/sales-ledger.ts')
const modal = read('src/components/sales/CommissionActions.tsx')
const table = read('src/components/sales/SalesTable.tsx')

/**
 * Correcting who earned a commission.
 *
 * Alex: "There is no way in correct this commission to update the sales
 * person, the owner profile should be able to adapt and change these."
 *
 * The salesperson was fixed at the moment of recording. Everything else on
 * a commission could be corrected — the invoice number, the payment, the
 * date, the notes — and the one field that decides where money goes could
 * not. A fee against the wrong name, or against none, is paid to the wrong
 * person or to nobody, quietly, every month until somebody reads the
 * commission run closely.
 *
 * Run against a real database: set, moved, cleared back to nobody, a junk
 * id refused and nothing written, the audit naming both sides, and the
 * per-person totals following the move.
 */

describe('the field exists at all', () => {
  it('is accepted by the amend schema', () => {
    expect(brokerageAmendSchema.parse({ soldById: 'slp_1' })).toEqual({ soldById: 'slp_1' })
  })

  it('folds an emptied box to nobody rather than to an empty string', () => {
    // "Not recorded" is a real state, and the ledger already prints it.
    // An empty string in the column would read as "recorded, and blank".
    expect(brokerageAmendSchema.parse({ soldById: '' })).toEqual({ soldById: null })
    expect(brokerageAmendSchema.parse({ soldById: '  ' })).toEqual({ soldById: null })
  })

  it('is left alone when the form does not send it', () => {
    // Every field here is partial: a form that sends four of six must not
    // blank the other two.
    expect(brokerageAmendSchema.parse({ reference: 'INV-1' })).toEqual({ reference: 'INV-1' })
  })
})

describe('the service', () => {
  it('checks the id is really a salesperson', () => {
    /*
     * The column is a nullable reference, so an id that is not a
     * salesperson would be accepted and then silently drop the fee out of
     * every per-person total that joins through it.
     */
    const fn = service.slice(service.indexOf('export async function amendBrokerage'))
    expect(fn).toMatch(/if \(!person\) throw new NotFoundError\('Salesperson'\)/)
    expect(fn).toMatch(/\.from\(salesPeople\)/)
    expect(fn).toMatch(/isNull\(salesPeople\.deletedAt\)/)
  })

  it('records who it moved from and who to, by name', () => {
    /*
     * The only entry on this form that is not enough on its own.
     * "Corrected the salesperson" does not say whose money moved.
     */
    expect(service).toMatch(/soldById: 'salesperson'/)
    expect(service).toMatch(/\{ soldBy: \{ from: from \?\? 'nobody', to: to \?\? 'nobody' \} \}/)
  })

  it('still refuses to edit a voided commission', () => {
    // Withdrawn income is not a record to keep tidy.
    expect(service).toMatch(/That commission was voided, so it can no longer be corrected/)
  })
})

describe('the current name reaches the form', () => {
  it('is selected and returned by the commission list', () => {
    expect(service).toMatch(/soldById: brokerages\.soldById/)
    const row = service.slice(service.indexOf('export interface BrokerageRow'))
    expect(row.slice(0, row.indexOf('}'))).toMatch(/soldById: string \| null/)
  })

  it('is carried by the ledger rather than hard-coded null', () => {
    /*
     * It was `soldById: null` on the commission row, so the form could not
     * have opened on the right name even once the field existed. The same
     * shape of fault as the buy-back invoice number: a column declared and
     * then filled in with nothing.
     */
    expect(ledger).toMatch(/soldById: row\.soldById,\n\s+soldByName: row\.soldByName,/)
  })

  it('is handed to the modal with the people to choose from', () => {
    expect(table).toMatch(/soldById: sale\.soldById \?\? '',/)
    expect(table).toMatch(/salesPeople=\{salesPeople\}/)
  })
})

describe('the form', () => {
  it('offers the field, and sends it', () => {
    expect(modal).toMatch(/name="soldById"/)
    expect(modal).toMatch(/label="Sold by"/)
    expect(modal).toMatch(/reference, paymentStatus, brokeredOn, soldById, notes,/)
  })

  it('offers "not recorded" as something you can choose, not only leave', () => {
    // Taking a name off is as real a correction as putting one on.
    expect(modal).toMatch(/\{ value: '', label: 'Not recorded' \}/)
  })

  it('reloads when opened on a different commission', () => {
    // Or it would show the last one somebody looked at.
    expect(codeOf(modal)).toMatch(/setSoldById\(target\.soldById\)/)
  })

  it('says what the field decides', () => {
    // It is the one control on this form that moves money.
    expect(modal).toMatch(/commission run|retainer/)
  })
})
