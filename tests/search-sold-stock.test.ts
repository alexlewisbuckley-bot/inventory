import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'src/server/repositories/search-repository.ts'), 'utf8')

/**
 * Every watch the business has ever handled stays in this table, so without
 * a filter the Watches group becomes a history of the firm with the few
 * pieces you can actually sell buried in it. Two identical Daytonas, one on
 * the shelf and one sold in 2024, are not two equally useful answers.
 */
describe('searching for a watch', () => {
  it('leaves sold stock out of the Watches group', () => {
    expect(source).toMatch(/AND w\.status <> 'SOLD'/)
  })

  it('keeps the filter on the watch query rather than the sale one', () => {
    // A sale is sold by definition. The same clause on saleHits would empty
    // the one group a sold piece is supposed to appear in.
    const watchQuery = source.slice(source.indexOf('async function watchHits'), source.indexOf('async function contactHits'))
    const saleQuery = source.slice(source.indexOf('async function saleHits'), source.indexOf('async function taskHits'))
    expect(watchQuery).toMatch(/w\.status <> 'SOLD'/)
    expect(saleQuery).not.toMatch(/status <> 'SOLD'/)
  })
})

describe('finding a watch that has already sold', () => {
  const saleQuery = source.slice(source.indexOf('async function saleHits'), source.indexOf('async function taskHits'))

  it('matches the reference, not only the invoice', () => {
    // Hiding sold watches would otherwise make a sold piece unfindable by
    // the only thing anybody knows about it: what it is.
    expect(saleQuery).toMatch(/w\.model ILIKE/)
  })

  it('matches the serial, which names exactly one watch', () => {
    expect(saleQuery).toMatch(/w\.serial ILIKE/)
  })

  it('matches the stock number', () => {
    expect(saleQuery).toMatch(/w\.stock_no::text ILIKE/)
  })

  it('matches the maison and the nickname', () => {
    expect(saleQuery).toMatch(/b\.name ILIKE/)
    expect(saleQuery).toMatch(/w\.nickname ILIKE/)
  })

  it('still matches the paperwork it always did', () => {
    expect(saleQuery).toMatch(/s\.invoice_no ILIKE/)
    expect(saleQuery).toMatch(/s\.customer_name ILIKE/)
    expect(saleQuery).toMatch(/s\.customer_company ILIKE/)
  })

  it('ranks an exact stock number first, as the watch search does', () => {
    expect(saleQuery).toMatch(/w\.stock_no = \$\{exactStock\}/)
  })

  it('shows the serial, so two of one reference can be told apart', () => {
    expect(saleQuery).toMatch(/w\.serial/)
    expect(source).toMatch(/serial \$\{row\.serial\}/)
  })
})
