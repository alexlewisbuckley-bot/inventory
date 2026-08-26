import { describe, expect, it } from 'vitest'
import {
  parseInvoiceText, detectVatScheme, parseAmount, parseInvoiceDate,
  mergeExtractions, coerceExtraction, EMPTY_EXTRACTION,
  type ExtractedInvoice,
} from '@/lib/invoice'

/**
 * Reading an invoice.
 *
 * These book stock in with no human confirmation, so the tests are written
 * around the mistakes that would be expensive and invisible: the buyer read as
 * the supplier, a serial read as a reference, a margin-scheme purchase filed as
 * standard rated, and a March invoice landing in December because somebody
 * assumed American dates.
 */

const INVOICE = `
GB LUXURY TRADING LIMITED
14 Hatton Garden, London EC1N 8AT
VAT Reg No: GB 384 2910 55
Company No: 09183472
Tel: +44 20 7405 1122
accounts@gbluxury.co.uk

TAX INVOICE

Invoice No: GBL-2026-0418
Invoice Date: 08/04/2026

Invoice To:
Bluecroft Finance Limited
27 St James's Street, London SW1A 1HA

Description                                              Amount
Rolex Submariner 126610LN, 2021, full set    £8,950.00
Rolex GMT-Master II 126711CHNR serial 1T41F071, 2022    £13,105.51
Omega Speedmaster 310.30.42.50.01.002, 2020    £4,200.00

Subtotal: £26,255.51
VAT: £0.00
Total Due: £26,255.51

Sold under the VAT Margin Scheme for second-hand goods.
Payment terms: 30 days
`

describe('reading a supplier invoice', () => {
  const parsed = parseInvoiceText(INVOICE)

  it('takes the supplier from the letterhead, never from "Invoice To"', () => {
    // Booking stock in against yourself is the one error that would be
    // internally consistent and therefore invisible.
    expect(parsed.supplier.name).toMatch(/GB LUXURY/i)
    expect(parsed.supplier.name).not.toMatch(/Bluecroft/i)
    expect(parsed.supplier.legalName).toMatch(/GB LUXURY TRADING LIMITED/i)
  })

  it('reads the identifiers that make entity resolution reliable', () => {
    expect(parsed.supplier.vatNo).toBe('GB384291055')
    expect(parsed.supplier.registrationNo).toBe('09183472')
    expect(parsed.supplier.email).toBe('accounts@gbluxury.co.uk')
  })

  it('reads the invoice number and a day-first date', () => {
    expect(parsed.invoiceNo).toBe('GBL-2026-0418')
    // 08/04/2026 is April, not August. Getting this backwards moves a purchase
    // four months in every ageing and holding-period figure.
    expect(parsed.invoiceDate?.slice(0, 10)).toBe('2026-04-08')
  })

  it('recognises the margin scheme, which decides the VAT on resale', () => {
    expect(parsed.vatScheme).toBe('MARGIN')
  })

  it('finds one line per watch, with brand, reference and cost', () => {
    expect(parsed.lines.length).toBe(3)

    const gmt = parsed.lines.find((line) => line.reference === '126711CHNR')
    expect(gmt).toBeDefined()
    expect(gmt!.brand).toBe('Rolex')
    expect(gmt!.serial).toBe('1T41F071')
    expect(gmt!.unitAmount).toBe(13_105.51)
    expect(gmt!.year).toBe(2022)
  })

  it('does not mistake the serial for the reference', () => {
    const gmt = parsed.lines.find((line) => line.serial === '1T41F071')
    expect(gmt!.reference).toBe('126711CHNR')
  })

  it('reads the totals without swallowing the VAT line as the total', () => {
    expect(parsed.netAmount).toBe(26_255.51)
    expect(parsed.grossAmount).toBe(26_255.51)
    expect(parsed.vatAmount).toBe(0)
  })

  it('ignores the totals block when looking for watches', () => {
    for (const line of parsed.lines) {
      expect(line.description).not.toMatch(/^(subtotal|total|vat)/i)
    }
  })
})

/**
 * The layout the common bookkeeping tools generate.
 *
 * Taken from a real supplier invoice, with the identifying details changed.
 * It broke every assumption the first parser made, and each of those
 * assumptions was reasonable right up until a real document arrived:
 *
 *  - one watch spans four lines, so no single line carries both a maker and a
 *    price and a line-at-a-time reader finds nothing at all;
 *  - the seller is in the footer beside the bank details, while the top of the
 *    page is the customer;
 *  - the first email on the page belongs to the buyer;
 *  - "Terms: NET 0" is not a net total of zero.
 */
const FOOTER_SUPPLIER_INVOICE = `
Invoice No: 1409
Date: 25/08/2026
Terms: NET 0
Due Date: 25/08/2026
Invoice
Bill To: Bluecroft Traders Ltd
buyer@example.com
6 Ambassador Place, Stockport Road,
Altrincham, WA15 8DB
Description Quantity Rate Amount
Rolex skydweller
Model no - 336934
Serial no - 30ER3414
1 £18,600.00 £18,600.00*
*Indicates non-taxable item
Payment Instructions
Bank Details
Northgate Watch Traders Ltd
Sort code: 00-00-00
Account number: 00000000
THIS INVOICE HAS BEEN PREPARED FOR THE SECOND HAND
MARGIN SCHEME - NO TAX DUE.
Subtotal £18,600.00
Total £18,600.00
Paid £0.00
Balance Due £18,600.00
Northgate Watch Traders Ltd
128 city road
London
EC1V 2NX
seller@example.com
Company number: 16573151
1 / 1
`

describe('an invoice whose watch spans four lines', () => {
  const parsed = parseInvoiceText(FOOTER_SUPPLIER_INVOICE)

  it('finds the watch, though no single line carries both a maker and a price', () => {
    expect(parsed.lines).toHaveLength(1)
    const watch = parsed.lines[0]!
    expect(watch.brand).toBe('Rolex')
    expect(watch.reference).toBe('336934')
    expect(watch.serial).toBe('30ER3414')
    expect(watch.unitAmount).toBe(18_600)
    expect(watch.quantity).toBe(1)
  })

  it('takes the seller from the footer, not the customer from the top', () => {
    expect(parsed.supplier.name).toBe('Northgate Watch Traders Ltd')
    expect(parsed.supplier.name).not.toMatch(/Bluecroft/i)
    expect(parsed.supplier.registrationNo).toBe('16573151')
  })

  it('takes the seller’s email, not the first one on the page', () => {
    expect(parsed.supplier.email).toBe('seller@example.com')
  })

  it('reads "no tax due" prose as the margin scheme', () => {
    expect(parsed.vatScheme).toBe('MARGIN')
  })

  it('does not read "Terms: NET 0" as a net total', () => {
    // Zero here would report the watch as bought for nothing.
    expect(parsed.netAmount).toBe(18_600)
    expect(parsed.grossAmount).toBe(18_600)
  })

  it('stops at the totals rather than booking them in as stock', () => {
    for (const line of parsed.lines) {
      expect(line.description).not.toMatch(/subtotal|balance|paid/i)
    }
  })
})

describe('the seller\u2019s address and phone', () => {
  it('reads a footer address, anchored on the postcode', () => {
    const parsed = parseInvoiceText(FOOTER_SUPPLIER_INVOICE)
    expect(parsed.supplier.addressLine1).toBe('128 city road')
    expect(parsed.supplier.city).toBe('London')
    expect(parsed.supplier.postcode).toBe('EC1V 2NX')
  })

  it('reads a town printed on the same line as the postcode', () => {
    // "Hathersage, S32 1DD" — the shape that was missed entirely, because
    // nothing was asking for an address at all.
    const parsed = parseInvoiceText(`
Peak Horology Ltd
12 Main Road
Hathersage, S32 1DD
01433 650 123
Description Amount
Rolex Explorer 224270 £6,400.00
Total £6,400.00
`)
    expect(parsed.supplier.postcode).toBe('S32 1DD')
    expect(parsed.supplier.city).toBe('Hathersage')
    expect(parsed.supplier.addressLine1).toBe('12 Main Road')
  })

  it('reads a phone number that carries no label', () => {
    const parsed = parseInvoiceText(`
Peak Horology Ltd
12 Main Road
Hathersage, S32 1DD
01433 650 123
Description Amount
Rolex Explorer 224270 £6,400.00
`)
    expect(parsed.supplier.phone).toBe('01433 650 123')
  })

  it('never reads a bank account or company number as a phone number', () => {
    const parsed = parseInvoiceText(`
Peak Horology Ltd
Sort code: 23-08-01
Account number: 19747625
Company number: 16573151
Description Amount
Rolex Explorer 224270 £6,400.00
`)
    expect(parsed.supplier.phone).toBeNull()
  })
})

describe('VAT treatment', () => {
  it('reads the margin scheme however it is worded', () => {
    expect(detectVatScheme('Sold under the VAT Margin Scheme')).toBe('MARGIN')
    expect(detectVatScheme('second-hand margin scheme applies')).toBe('MARGIN')
    expect(detectVatScheme('Global accounting scheme')).toBe('MARGIN')
  })

  it('prefers the margin scheme over a rate the same invoice quotes', () => {
    // A margin invoice often prints "VAT @ 20%" against the margin itself.
    // Reading that as standard rated would let the watch be resold with VAT
    // charged on the whole price.
    expect(detectVatScheme('Margin scheme. VAT @ 20% on the margin.')).toBe('MARGIN')
  })

  it('reads the other schemes it is told about', () => {
    expect(detectVatScheme('Reverse charge applies')).toBe('REVERSE_CHARGE')
    expect(detectVatScheme('Zero-rated export sale')).toBe('ZERO_RATED')
    expect(detectVatScheme('VAT @ 20%')).toBe('STANDARD')
  })

  it('says it does not know rather than guessing', () => {
    expect(detectVatScheme('Thank you for your business')).toBe('UNKNOWN')
  })
})

describe('amounts and dates', () => {
  it('reads money however the invoice writes it', () => {
    expect(parseAmount('£13,105.51')).toBe(13_105.51)
    expect(parseAmount('13105.51')).toBe(13_105.51)
    expect(parseAmount('$ 8,950.00')).toBe(8950)
    expect(parseAmount('GBP 1,000')).toBe(1000)
  })

  it('refuses text that is not a figure', () => {
    expect(parseAmount('on application')).toBeNull()
    expect(parseAmount('')).toBeNull()
    expect(parseAmount(null)).toBeNull()
  })

  it('reads British dates day-first', () => {
    expect(parseInvoiceDate('08/04/2026')?.slice(0, 10)).toBe('2026-04-08')
    expect(parseInvoiceDate('2026-04-08')?.slice(0, 10)).toBe('2026-04-08')
    expect(parseInvoiceDate('8 April 2026')?.slice(0, 10)).toBe('2026-04-08')
    expect(parseInvoiceDate('8th Apr 2026')?.slice(0, 10)).toBe('2026-04-08')
  })

  it('returns nothing for a date it cannot read', () => {
    expect(parseInvoiceDate('soon')).toBeNull()
    expect(parseInvoiceDate('')).toBeNull()
  })
})

describe('merging the two readings', () => {
  const rules: ExtractedInvoice = {
    ...EMPTY_EXTRACTION,
    supplier: { ...EMPTY_EXTRACTION.supplier, name: 'GB Luxury', vatNo: 'GB384291055' },
    invoiceNo: 'GBL-2026-0418',
    vatScheme: 'MARGIN',
    lines: [{
      description: 'Rolex 126610LN', brand: 'Rolex', reference: '126610LN', serial: null,
      year: null, productType: 'WATCH', unitAmount: 8950, vatAmount: null, quantity: 1,
    }],
  }

  it('falls back to the rules entirely when Claude is not configured', () => {
    expect(mergeExtractions(null, rules)).toEqual(rules)
  })

  it('prefers Claude but fills its gaps from the rules', () => {
    const ai: ExtractedInvoice = {
      ...EMPTY_EXTRACTION,
      supplier: { ...EMPTY_EXTRACTION.supplier, name: 'GB Luxury Trading Limited', vatNo: null },
      invoiceNo: null,
      lines: [],
    }
    const merged = mergeExtractions(ai, rules)

    expect(merged.supplier.name).toBe('GB Luxury Trading Limited')
    // The VAT number is a regular expression's job, and Claude left it out.
    expect(merged.supplier.vatNo).toBe('GB384291055')
    expect(merged.invoiceNo).toBe('GBL-2026-0418')
    // An explicit scheme from either reader beats UNKNOWN from the other.
    expect(merged.vatScheme).toBe('MARGIN')
    // And the reader that found watches wins the lines.
    expect(merged.lines).toHaveLength(1)
  })

  it('takes Claude’s lines when it found more of them', () => {
    const ai: ExtractedInvoice = {
      ...EMPTY_EXTRACTION,
      lines: [rules.lines[0]!, { ...rules.lines[0]!, reference: '126711CHNR' }],
    }
    expect(mergeExtractions(ai, rules).lines).toHaveLength(2)
  })
})

describe('what comes back from Claude', () => {
  it('survives nulls, strings where numbers belong, and unknown enums', () => {
    const coerced = coerceExtraction({
      supplier: { name: '  GB Luxury  ', vatNo: 'null', email: null },
      invoiceNo: 'GBL-1',
      invoiceDate: '08/04/2026',
      currency: 'ZWL',
      grossAmount: '£8,950.00',
      vatScheme: 'MADE_UP',
      lines: [{ description: 'Rolex', brand: 'Rolex', unitAmount: '8950', quantity: 0, productType: 'SPACESHIP' }],
    })

    expect(coerced!.supplier.name).toBe('GB Luxury')
    // The string "null" is not a value; it is a model writing the word.
    expect(coerced!.supplier.vatNo).toBeNull()
    expect(coerced!.currency).toBe('GBP')
    expect(coerced!.vatScheme).toBe('UNKNOWN')
    expect(coerced!.grossAmount).toBe(8950)
    expect(coerced!.invoiceDate?.slice(0, 10)).toBe('2026-04-08')
    expect(coerced!.lines[0]!.unitAmount).toBe(8950)
    // A quantity of zero would create no stock and report success.
    expect(coerced!.lines[0]!.quantity).toBe(1)
    expect(coerced!.lines[0]!.productType).toBe('WATCH')
  })

  it('returns nothing rather than a hollow invoice', () => {
    expect(coerceExtraction(null)).toBeNull()
    expect(coerceExtraction('sorry, I cannot help with that')).toBeNull()
  })
})
