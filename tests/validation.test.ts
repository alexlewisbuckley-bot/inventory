import { describe, expect, it } from 'vitest'
import { watchCreateSchema, saleCreateSchema, watchQuerySchema, fieldErrors } from '@/lib/validation'

const baseWatch = {
  brandId: 'brd_1', model: '126711CHNR', supplierId: 'sup_1', locationId: 'loc_1',
  purchaseDate: '2026-04-08', purchasePriceGbp: 13106,
}

describe('watch validation', () => {
  it('accepts a complete purchase', () => {
    expect(watchCreateSchema.safeParse(baseWatch).success).toBe(true)
  })

  it('rejects a purchase dated in the future', () => {
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    const result = watchCreateSchema.safeParse({ ...baseWatch, purchaseDate: future })
    expect(result.success).toBe(false)
    if (!result.success) expect(fieldErrors(result.error).purchaseDate).toMatch(/future/i)
  })

  it('rejects a negative purchase price', () => {
    expect(watchCreateSchema.safeParse({ ...baseWatch, purchasePriceGbp: -5 }).success).toBe(false)
  })

  it('treats an empty estimated sale price as not-yet-priced rather than zero', () => {
    const result = watchCreateSchema.safeParse({ ...baseWatch, estSaleUsd: '' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.estSaleUsd).toBeNull()
  })

  it('requires the references a watch cannot exist without', () => {
    const result = watchCreateSchema.safeParse({ ...baseWatch, supplierId: '', locationId: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const errors = fieldErrors(result.error)
      expect(errors.supplierId).toBeDefined()
      expect(errors.locationId).toBeDefined()
    }
  })
})

describe('sale validation', () => {
  const baseSale = { watchId: 'wch_1', invoiceNo: 'INV-2026-118', saleDate: '2026-07-01', saleAmountUsd: 18900 }

  it('accepts a complete sale', () => {
    expect(saleCreateSchema.safeParse(baseSale).success).toBe(true)
  })

  it('requires an invoice number', () => {
    expect(saleCreateSchema.safeParse({ ...baseSale, invoiceNo: '' }).success).toBe(false)
  })

  it('rejects a sale dated in the future', () => {
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    expect(saleCreateSchema.safeParse({ ...baseSale, saleDate: future }).success).toBe(false)
  })

  it('normalises a blank customer email to null rather than an empty string', () => {
    const result = saleCreateSchema.safeParse({ ...baseSale, customerEmail: '' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.customerEmail).toBeNull()
  })
})

describe('list query defaults', () => {
  it('applies safe defaults when nothing is supplied', () => {
    const query = watchQuerySchema.parse({})
    expect(query.page).toBe(1)
    expect(query.perPage).toBe(25)
    expect(query.sort).toBe('stockNo')
    expect(query.includeDeleted).toBe(false)
  })

  it('caps page size so a crafted URL cannot request the whole table', () => {
    expect(watchQuerySchema.safeParse({ perPage: 10_000 }).success).toBe(false)
  })

  it('rejects an unknown sort column', () => {
    expect(watchQuerySchema.safeParse({ sort: 'passwordHash' }).success).toBe(false)
  })
})

describe('empty-input coercion guards', () => {
  // Regression: z.coerce.number() turns both '' and null into 0, which passes
  // .min(0). If the numeric branch is tried before the null branch, a blank
  // price is stored as zero and the watch reports a large false loss.
  it('never turns a blank money field into zero', () => {
    for (const blank of ['', null, undefined]) {
      const result = watchCreateSchema.safeParse({ ...baseWatch, estSaleUsd: blank })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.estSaleUsd ?? null).toBeNull()
    }
  })

  it('never turns a blank year into year zero', () => {
    for (const blank of ['', null, undefined]) {
      const result = watchCreateSchema.safeParse({ ...baseWatch, year: blank })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.year ?? null).toBeNull()
    }
  })

  it('still parses a real value through the same field', () => {
    const result = watchCreateSchema.safeParse({ ...baseWatch, estSaleUsd: '18900', year: '2021' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.estSaleUsd).toBe(18900)
      expect(result.data.year).toBe(2021)
    }
  })
})
