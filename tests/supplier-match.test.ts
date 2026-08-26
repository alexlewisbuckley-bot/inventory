import { describe, expect, it } from 'vitest'
import {
  resolveSupplier, normaliseSupplierName, similarity, FUZZY_THRESHOLD,
  type SupplierCandidate,
} from '@/lib/supplier-match'
import type { ExtractedSupplier } from '@/lib/invoice'

/**
 * Matching the firm on an invoice to the firm on the book.
 *
 * Both failure directions cost real money and neither announces itself. A
 * false match posts somebody else's purchase into a supplier's trading
 * history; a false miss splits one dealer across two records so that neither
 * shows what you actually buy from them. These tests are mostly about the
 * near misses, because the easy cases were never the risk.
 */

const book = (rows: Partial<SupplierCandidate>[]): SupplierCandidate[] =>
  rows.map((row, index) => ({
    id: row.id ?? `sup_${index}`,
    name: row.name ?? '',
    legalName: row.legalName ?? null,
    vatNo: row.vatNo ?? null,
    registrationNo: row.registrationNo ?? null,
    email: row.email ?? null,
    contactEmail: row.contactEmail ?? null,
  }))

const invoice = (fields: Partial<ExtractedSupplier>): ExtractedSupplier => ({
  name: null, legalName: null, vatNo: null, registrationNo: null,
  email: null, phone: null, country: null, ...fields,
})

describe('normalising a trading name', () => {
  it('strips what differs between two spellings of one firm', () => {
    expect(normaliseSupplierName('GB Luxury Limited')).toBe('gb luxury')
    expect(normaliseSupplierName('G.B. Luxury Ltd.')).toBe('gb luxury')
    expect(normaliseSupplierName('  gb   luxury  ')).toBe('gb luxury')
  })

  it('reads & and "and" as the same word', () => {
    expect(normaliseSupplierName('Watches & Wonders')).toBe(normaliseSupplierName('Watches and Wonders'))
  })
})

describe('name similarity', () => {
  it('ignores word order, which edit distance does not', () => {
    expect(similarity('gb luxury watches', 'luxury watches gb')).toBeGreaterThan(0.7)
  })

  it('scores unrelated firms low', () => {
    expect(similarity('gb luxury', 'chrono hub')).toBeLessThan(0.3)
  })
})

describe('resolving the supplier', () => {
  it('matches on VAT number even when the name is written differently', () => {
    const existing = book([{ id: 'sup_1', name: 'GB Luxury', vatNo: 'GB 384 2910 55' }])
    const result = resolveSupplier(
      invoice({ name: 'G.B. Luxury Trading Ltd', vatNo: 'GB384291055' }),
      existing,
    )
    expect(result.kind).toBe('VAT_NO')
    expect(result.candidate?.id).toBe('sup_1')
  })

  it('matches on company number', () => {
    const existing = book([{ id: 'sup_1', name: 'Chrono Hub', registrationNo: '09183472' }])
    const result = resolveSupplier(invoice({ name: 'Completely Different Name', registrationNo: '09183472' }), existing)
    expect(result.kind).toBe('REGISTRATION')
  })

  it('matches Ltd against Limited without needing an identifier', () => {
    const existing = book([{ id: 'sup_1', name: 'GB Luxury Limited' }])
    const result = resolveSupplier(invoice({ name: 'GB Luxury Ltd' }), existing)
    expect(result.kind).toBe('EXACT')
    expect(result.candidate?.id).toBe('sup_1')
  })

  it('matches the invoice’s legal entity against the name the team files it under', () => {
    const existing = book([{ id: 'sup_1', name: 'Chrono Hub', legalName: 'Chrono Hub Trading Limited' }])
    const result = resolveSupplier(invoice({ name: null, legalName: 'Chrono Hub Trading Ltd' }), existing)
    expect(result.candidate?.id).toBe('sup_1')
  })

  it('matches on a company email domain', () => {
    const existing = book([{ id: 'sup_1', name: 'Hatton Watches', email: 'sales@hattonwatches.co.uk' }])
    const result = resolveSupplier(
      invoice({ name: 'HW Trading', email: 'accounts@hattonwatches.co.uk' }),
      existing,
    )
    expect(result.kind).toBe('EMAIL')
  })

  it('never matches two dealers because they both use gmail', () => {
    const existing = book([{ id: 'sup_1', name: 'Alpha Watches', email: 'alpha@gmail.com' }])
    const result = resolveSupplier(invoice({ name: 'Beta Timepieces', email: 'beta@gmail.com' }), existing)
    expect(result.kind).toBe('CREATED')
  })

  it('creates rather than merging two firms that differ by their city', () => {
    // The expensive false positive: same trade, same words, different company.
    const existing = book([{ id: 'sup_1', name: 'Watch Traders London' }])
    const result = resolveSupplier(invoice({ name: 'Watch Traders Manchester' }), existing)
    expect(result.kind).toBe('CREATED')
    expect(result.candidate).toBeNull()
  })

  it('matches through a typo close enough to be the same firm', () => {
    const existing = book([{ id: 'sup_1', name: 'Bucherer Fine Watches' }])
    const result = resolveSupplier(invoice({ name: 'Bucherer Fine Watchs' }), existing)
    expect(result.kind).toBe('FUZZY')
    expect(result.score).toBeGreaterThanOrEqual(FUZZY_THRESHOLD)
  })

  it('creates when the book is empty, so a first invoice still books in', () => {
    const result = resolveSupplier(invoice({ name: 'A Brand New Dealer' }), [])
    expect(result.kind).toBe('CREATED')
  })

  it('ignores an identifier too short to identify anything', () => {
    // A stray "VAT 12" on a document must not match the first firm with a
    // short number, so identifiers below a sane length are not considered.
    const existing = book([{ id: 'sup_1', name: 'Alpha', vatNo: '12' }])
    const result = resolveSupplier(invoice({ name: 'Beta', vatNo: '12' }), existing)
    expect(result.kind).toBe('CREATED')
  })
})
