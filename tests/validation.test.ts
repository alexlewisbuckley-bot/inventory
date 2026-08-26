import { describe, expect, it } from 'vitest'
import { watchCreateSchema, saleCreateSchema, watchQuerySchema, fieldErrors } from '@/lib/validation'

const baseWatch = {
  brandId: 'brd_1', model: '126711CHNR', supplierId: 'sup_1', locationId: 'loc_1',
  purchaseDate: '2026-04-08', purchaseAmount: 13106,
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

  /**
   * Regression: the money inputs group thousands as they are typed and the
   * intake form posts that string as-is, so every purchase over £999 entered
   * by hand came back as "Purchase price must be a number" — on a field
   * showing a perfectly good number.
   */
  it('accepts a price typed with the grouping the input itself adds', () => {
    const result = watchCreateSchema.safeParse({ ...baseWatch, purchaseAmount: '13,105.51' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.purchaseAmount).toBe(13_105.51)
  })

  it('groups the optional estimate the same way, without losing the blank case', () => {
    const grouped = watchCreateSchema.safeParse({ ...baseWatch, estSaleAmount: '14,980.00' })
    expect(grouped.success).toBe(true)
    if (grouped.success) expect(grouped.data.estSaleAmount).toBe(14_980)
    // And a blank one is still unpriced rather than free.
    const blank = watchCreateSchema.safeParse({ ...baseWatch, estSaleAmount: '' })
    expect(blank.success).toBe(true)
    if (blank.success) expect(blank.data.estSaleAmount).toBeNull()
  })

  it('still rejects text that is not a number in disguise', () => {
    const result = watchCreateSchema.safeParse({ ...baseWatch, purchaseAmount: 'about ten grand' })
    expect(result.success).toBe(false)
    if (!result.success) expect(fieldErrors(result.error).purchaseAmount).toMatch(/number/i)
  })

  it('rejects a negative purchase price', () => {
    expect(watchCreateSchema.safeParse({ ...baseWatch, purchaseAmount: -5 }).success).toBe(false)
  })

  it('treats an empty estimated sale price as not-yet-priced rather than zero', () => {
    const result = watchCreateSchema.safeParse({ ...baseWatch, estSaleAmount: '' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.estSaleAmount).toBeNull()
  })

  it('defaults an omitted purchase currency to the reporting base', () => {
    // A form posted without the currency select must not be read as dollars —
    // the whole capital figure derives from this.
    const result = watchCreateSchema.safeParse(baseWatch)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.purchaseCurrency).toBe('GBP')
      expect(result.data.estSaleCurrency).toBe('GBP')
    }
  })

  it('accepts a purchase agreed in a non-base currency', () => {
    const result = watchCreateSchema.safeParse({ ...baseWatch, purchaseAmount: 48000, purchaseCurrency: 'AED' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.purchaseCurrency).toBe('AED')
  })

  /**
   * The product type.
   *
   * Nearly every record is a watch, so the default has to hold for callers
   * that never mention it — the importer, the sourcing hand-off, a form posted
   * before the field existed. Anything the system does not recognise is a
   * rejection rather than a silent WATCH, because a type it cannot read is a
   * bug somewhere, not a watch.
   */
  it('defaults an unstated product type to a watch', () => {
    const result = watchCreateSchema.safeParse(baseWatch)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.productType).toBe('WATCH')
  })

  it('accepts the occasional piece that is not a watch', () => {
    for (const type of ['JEWELLERY', 'HANDBAG', 'ACCESSORY', 'OTHER']) {
      const result = watchCreateSchema.safeParse({ ...baseWatch, productType: type })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.productType).toBe(type)
    }
  })

  it('rejects a product type it does not recognise', () => {
    expect(watchCreateSchema.safeParse({ ...baseWatch, productType: 'CAR' }).success).toBe(false)
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
  const baseSale = { watchId: 'wch_1', invoiceNo: 'INV-2026-118', saleDate: '2026-07-01', saleAmount: 18900 }

  it('accepts a complete sale', () => {
    expect(saleCreateSchema.safeParse(baseSale).success).toBe(true)
  })

  it('defaults an omitted sale currency to the reporting base', () => {
    // A sale posted without a currency must not be silently treated as USD —
    // every stored figure derives from this, so the default has to be the
    // currency the rest of the system reports in.
    const result = saleCreateSchema.safeParse(baseSale)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.saleCurrency).toBe('GBP')
  })

  it('accepts a sale agreed in a non-base currency', () => {
    const result = saleCreateSchema.safeParse({ ...baseSale, saleCurrency: 'AED' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.saleCurrency).toBe('AED')
  })

  it('rejects a currency the application does not support', () => {
    expect(saleCreateSchema.safeParse({ ...baseSale, saleCurrency: 'EUR' }).success).toBe(false)
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
      const result = watchCreateSchema.safeParse({ ...baseWatch, estSaleAmount: blank })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.estSaleAmount ?? null).toBeNull()
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
    const result = watchCreateSchema.safeParse({ ...baseWatch, estSaleAmount: '18900', year: '2021' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.estSaleAmount).toBe(18900)
      expect(result.data.year).toBe(2021)
    }
  })
})
