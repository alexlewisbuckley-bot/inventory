import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  candidates, daysApart, flagsFor, proposeLinks, sameMoney, tolerance,
  type Payable, type Payment,
} from '@/lib/wallet-match'
import { normaliseAddress, rawFromUsd, usdFromRaw, validAddress } from '@/lib/usdt'
import { readEtherscanRow, readTronRow } from '@/server/services/chain-reader'
import { AI_CONFIDENCE_CEILING, validate } from '@/server/services/wallet-ai'

const read = (path: string) => readFileSync(path, 'utf8')

/** Dollars, as the rest of the system counts them: cents. */
const usd = (dollars: number) => Math.round(dollars * 100)

const payment = (over: Partial<Payment> & { id: string; amountUsd: number }): Payment => ({
  at: '2026-11-10T09:00:00Z',
  counterparty: 'TPayerAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  ...over,
})

const payable = (over: Partial<Payable> & { id: string; reference: string; dueUsd: number }): Payable => ({
  kind: 'SALE',
  label: 'Rolex 126610LV',
  totalUsd: over.dueUsd,
  at: '2026-11-08T09:00:00Z',
  ...over,
})

/**
 * A token amount is an integer of the smallest unit, and every bug in this
 * area is a rounding one.
 */
describe('reading a figure off the chain', () => {
  it('reads six decimals as cents', () => {
    // 126,519 USDT, as TronGrid sends it.
    expect(usdFromRaw('126519000000')).toBe(usd(126_519))
    expect(usdFromRaw('1500000')).toBe(usd(1.5))
  })

  it('does not go through a double', () => {
    /*
     * A 256-bit integer does not fit in a JavaScript number. Parsed as one,
     * this figure comes back as 9007199254740992 — a payment silently
     * recorded a cent light, which is the kind of error that is found a year
     * later by somebody else.
     */
    const raw = '9007199254740993000000'
    expect(usdFromRaw(raw)).toBeNull() // past what a safe integer holds, so refused
    expect(usdFromRaw('12345678901234567')).toBe(1234567890123)
  })

  it('rounds a half-cent the way a person would', () => {
    // 1.005 USDT: half a cent, rounded up rather than wherever the float lands.
    expect(usdFromRaw('1005000')).toBe(101)
    expect(usdFromRaw('1004999')).toBe(100)
  })

  it('refuses anything that is not an integer of units', () => {
    // An explorer that starts sending "1.5" must not be read as 1 cent.
    expect(usdFromRaw('1.5')).toBeNull()
    expect(usdFromRaw('')).toBeNull()
    expect(usdFromRaw('-5')).toBeNull()
    expect(usdFromRaw('1e6')).toBeNull()
  })

  it('goes back the way it came', () => {
    expect(rawFromUsd(usd(126_519))).toBe('126519000000')
    expect(usdFromRaw(rawFromUsd(usd(42.42)))).toBe(usd(42.42))
  })
})

describe('an address belongs to one chain', () => {
  it('knows a TRON address from an Ethereum one', () => {
    /*
     * The failure this prevents is quiet: an Ethereum address saved as a TRON
     * wallet scans clean for ever and accounts for none of the money.
     */
    expect(validAddress('TRON', 'TMuA6YqfCeX8EhbfYEg5y7S4DqzSJireY9')).toBe(true)
    expect(validAddress('TRON', '0x28c6c06298d514db089934071355e5743bf21d60')).toBe(false)
    expect(validAddress('ETHEREUM', '0x28c6c06298d514db089934071355e5743bf21d60')).toBe(true)
    expect(validAddress('ETHEREUM', 'TMuA6YqfCeX8EhbfYEg5y7S4DqzSJireY9')).toBe(false)
  })

  it('stores an Ethereum address the way it compares', () => {
    // The same wallet arrives checksummed from a wallet app and lower-cased
    // from an explorer. Stored as they come, they are two wallets and half
    // the payments never match.
    expect(normaliseAddress('ETHEREUM', '0x28C6C06298d514Db089934071355E5743bf21d60'))
      .toBe('0x28c6c06298d514db089934071355e5743bf21d60')
    // TRON base58 is case-sensitive and must not be touched.
    expect(normaliseAddress('TRON', 'TMuA6YqfCeX8EhbfYEg5y7S4DqzSJireY9'))
      .toBe('TMuA6YqfCeX8EhbfYEg5y7S4DqzSJireY9')
  })
})

describe('reading an explorer row', () => {
  it('reads a TronGrid transfer', () => {
    const row = {
      transaction_id: 'abc123',
      token_info: { symbol: 'USDT', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 },
      block_timestamp: 1_763_000_000_000,
      from: 'TPayer', to: 'TOurs', type: 'Transfer', value: '126519000000',
    }
    const transfer = readTronRow(row)
    expect(transfer?.txHash).toBe('abc123')
    expect(transfer?.amountUsd).toBe(usd(126_519))
    expect(transfer?.blockTime.toISOString()).toBe(new Date(1_763_000_000_000).toISOString())
  })

  it('reads an Etherscan transfer, seconds and all', () => {
    const row = {
      hash: '0xdead', from: '0xPAYER', to: '0xOURS', value: '50000000',
      timeStamp: '1763000000', tokenSymbol: 'USDT', tokenDecimal: '6',
      contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    }
    const transfer = readEtherscanRow(row)
    expect(transfer?.amountUsd).toBe(usd(50))
    // Seconds, not milliseconds: a thousandfold error puts every payment in 1970.
    expect(transfer?.blockTime.getUTCFullYear()).toBe(2025)
    expect(transfer?.from).toBe('0xpayer')
  })

  it('drops a row it cannot read whole rather than half-reading it', () => {
    /*
     * An explorer that renames a field should cost a transfer somebody can
     * see is missing, not a payment recorded as zero.
     */
    expect(readTronRow({ transaction_id: 'abc', from: 'a', to: 'b' })).toBeNull()
    expect(readEtherscanRow({ hash: '0x1', from: 'a', to: 'b', value: '1' })).toBeNull()
    expect(readTronRow(null)).toBeNull()
  })
})

describe('what counts as the same money', () => {
  it('allows the few dollars an exchange takes out of the middle', () => {
    // A USDT transfer pays its fee in TRX, so the amount that leaves arrives
    // — but an exchange withdrawal takes its cut out of the sum itself.
    expect(sameMoney(usd(126_519), usd(126_518))).toBe(true)
    // A quarter of one per cent of 126,519 dollars is 316.30, rounded.
    expect(tolerance(usd(126_519))).toBe(31_630)
  })

  it('does not call a different invoice the same money', () => {
    expect(sameMoney(usd(50_000), usd(49_000))).toBe(false)
    expect(sameMoney(usd(100), usd(90))).toBe(false)
  })

  it('has a floor, so a small invoice is not matched by proportion alone', () => {
    // A quarter of a per cent of 200 dollars is 50 cents, which would refuse
    // a payment a dollar light. The floor is what makes small invoices work.
    expect(sameMoney(usd(200), usd(199))).toBe(true)
  })
})

describe('matching a payment to an invoice', () => {
  it('takes the exact figure when one invoice is waiting for it', () => {
    const proposals = proposeLinks(
      [payment({ id: 'p1', amountUsd: usd(126_519) })],
      [
        payable({ id: 's1', reference: 'INV-0147', dueUsd: usd(126_519) }),
        payable({ id: 's2', reference: 'INV-0148', dueUsd: usd(40_000) }),
      ],
    )
    expect(proposals).toHaveLength(1)
    expect(proposals[0].targetId).toBe('s1')
    expect(proposals[0].confidence).toBeGreaterThanOrEqual(80)
    expect(proposals[0].reason).toContain('INV-0147')
  })

  it('says so when two invoices are waiting for the same figure', () => {
    /*
     * The case where a confident answer would be a lie. Both are proposed by
     * date rather than silently, and the confidence drops so the row sorts
     * itself in front of somebody.
     */
    const proposals = proposeLinks(
      [payment({ id: 'p1', amountUsd: usd(40_000), at: '2026-11-10T09:00:00Z' })],
      [
        payable({ id: 's1', reference: 'INV-0148', dueUsd: usd(40_000), at: '2026-11-09T09:00:00Z' }),
        payable({ id: 's2', reference: 'INV-0149', dueUsd: usd(40_000), at: '2026-10-05T09:00:00Z' }),
      ],
    )
    expect(proposals).toHaveLength(1)
    expect(proposals[0].targetId).toBe('s1')
    expect(proposals[0].reason).toContain('2 invoices are waiting')
    expect(proposals[0].confidence).toBeLessThan(90)
  })

  it('trusts an address that has paid this customer’s invoices before', () => {
    const known = proposeLinks(
      [payment({ id: 'p1', amountUsd: usd(40_000), knownCustomerId: 'cus_1' })],
      [payable({ id: 's1', reference: 'INV-0148', dueUsd: usd(40_000), customerId: 'cus_1' })],
    )
    const stranger = proposeLinks(
      [payment({ id: 'p2', amountUsd: usd(40_000) })],
      [payable({ id: 's1', reference: 'INV-0148', dueUsd: usd(40_000), customerId: 'cus_1' })],
    )
    expect(known[0].confidence).toBeGreaterThan(stranger[0].confidence)
  })

  it('puts three payments together into one invoice', () => {
    /*
     * What an exchange's daily limit does to a large invoice. The set is only
     * proposed when it is exact, because a near-miss over three payments is
     * arithmetic looking for an excuse.
     */
    const proposals = proposeLinks(
      [
        payment({ id: 'p1', amountUsd: usd(50_000), at: '2026-11-09T09:00:00Z' }),
        payment({ id: 'p2', amountUsd: usd(50_000), at: '2026-11-10T09:00:00Z' }),
        payment({ id: 'p3', amountUsd: usd(26_519), at: '2026-11-11T09:00:00Z' }),
      ],
      [payable({ id: 's1', reference: 'INV-0147', dueUsd: usd(126_519) })],
    )
    expect(proposals).toHaveLength(3)
    expect(new Set(proposals.map((p) => p.targetId))).toEqual(new Set(['s1']))
    expect(proposals.reduce((sum, p) => sum + p.amountUsd, 0)).toBe(usd(126_519))
    expect(proposals[0].reason).toContain('3 payments')
  })

  it('splits one payment across the invoices it settles', () => {
    // A dealer buying three watches pays once.
    const proposals = proposeLinks(
      [payment({ id: 'p1', amountUsd: usd(90_000) })],
      [
        payable({ id: 's1', reference: 'INV-0150', dueUsd: usd(50_000), customerId: 'cus_9' }),
        payable({ id: 's2', reference: 'INV-0151', dueUsd: usd(40_000), customerId: 'cus_9' }),
        payable({ id: 's3', reference: 'INV-0152', dueUsd: usd(12_000), customerId: 'cus_4' }),
      ],
    )
    expect(proposals.map((p) => p.targetId).sort()).toEqual(['s1', 's2'])
    expect(proposals.reduce((sum, p) => sum + p.amountUsd, 0)).toBe(usd(90_000))
  })

  it('will not reach across customers to make a sum work', () => {
    // 50,000 + 40,000 is 90,000 whoever the invoices belong to, and matching
    // across two customers to make the arithmetic close is how a payment gets
    // credited to a stranger.
    const proposals = proposeLinks(
      [payment({ id: 'p1', amountUsd: usd(90_000) })],
      [
        payable({ id: 's1', reference: 'INV-0150', dueUsd: usd(50_000), customerId: 'cus_1' }),
        payable({ id: 's2', reference: 'INV-0151', dueUsd: usd(40_000), customerId: 'cus_2' }),
      ],
    )
    expect(proposals).toHaveLength(0)
  })

  it('does not match an invoice from another season', () => {
    const far = proposeLinks(
      [payment({ id: 'p1', amountUsd: usd(40_000), at: '2026-11-10T09:00:00Z' })],
      [payable({ id: 's1', reference: 'INV-0100', dueUsd: usd(40_000), at: '2026-01-05T09:00:00Z' })],
    )
    expect(far).toHaveLength(0)
    expect(candidates(
      payment({ id: 'p1', amountUsd: usd(40_000) }),
      [payable({ id: 's1', reference: 'INV-0100', dueUsd: usd(40_000), at: '2026-01-05T09:00:00Z' })],
    )).toHaveLength(0)
  })

  it('leaves an invoice alone once it is settled', () => {
    const proposals = proposeLinks(
      [payment({ id: 'p1', amountUsd: usd(40_000) })],
      [payable({ id: 's1', reference: 'INV-0148', dueUsd: 0, totalUsd: usd(40_000) })],
    )
    expect(proposals).toHaveLength(0)
  })

  it('counts only what is left of a part-applied payment', () => {
    const proposals = proposeLinks(
      [payment({ id: 'p1', amountUsd: usd(90_000), linkedUsd: usd(50_000) })],
      [payable({ id: 's1', reference: 'INV-0151', dueUsd: usd(40_000) })],
    )
    expect(proposals).toHaveLength(1)
    expect(proposals[0].amountUsd).toBe(usd(40_000))
  })
})

/**
 * The half of the ask that earns the feature. A tool that reports only its
 * successes leaves the money nobody has accounted for exactly where it was.
 */
describe('what somebody should be told', () => {
  const now = '2026-11-20T09:00:00Z'

  it('says when money arrived that nothing accounts for', () => {
    const flags = flagsFor({
      payments: [payment({ id: 'p1', amountUsd: usd(75_000) })],
      payables: [],
      proposals: [],
      knownAddresses: ['TPayerAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
      now,
    })
    const unmatched = flags.find((flag) => flag.id.startsWith('unmatched:'))
    expect(unmatched?.tone).toBe('alert')
    // The figure is in the headline, where a row of flags is read.
    expect(unmatched?.headline).toContain('75,000.00 USDT')
    // And the detail names who sent it, so three of these are three
    // different sentences rather than one repeated three times.
    expect(unmatched?.detail).toContain('TPayer')
  })

  it('does not call our own transfer income', () => {
    /*
     * Moving stock funds between our own wallets is not a payment, and a
     * reconciliation tool that files it as one invents revenue.
     */
    const flags = flagsFor({
      payments: [payment({ id: 'p1', amountUsd: usd(200_000), counterparty: 'TOursBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' })],
      payables: [],
      proposals: [],
      ourAddresses: ['TOursBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'],
      now,
    })
    expect(flags.find((flag) => flag.id.startsWith('internal:'))).toBeTruthy()
    expect(flags.find((flag) => flag.id.startsWith('unmatched:'))).toBeUndefined()
  })

  it('knows a test transfer when it sees one', () => {
    // Sending a dollar first to check the address is the habit of everybody
    // who has ever lost a payment to a typo. The real one follows.
    const flags = flagsFor({
      payments: [payment({ id: 'p1', amountUsd: usd(1) })],
      payables: [],
      proposals: [],
      now,
    })
    expect(flags.find((flag) => flag.id.startsWith('dust:'))?.headline).toContain('test transfer')
    expect(flags.find((flag) => flag.id.startsWith('unmatched:'))).toBeUndefined()
  })

  it('points out a payer we have never been paid by', () => {
    const flags = flagsFor({
      payments: [payment({ id: 'p1', amountUsd: usd(40_000) })],
      payables: [],
      proposals: [{ paymentId: 'p1', kind: 'SALE', targetId: 's1', amountUsd: usd(40_000), confidence: 90, reason: '' }],
      knownAddresses: [],
      now,
    })
    expect(flags.find((flag) => flag.id.startsWith('new-payer:'))?.tone).toBe('warn')
  })

  it('says what is still out on a part-paid invoice', () => {
    const flags = flagsFor({
      payments: [payment({ id: 'p1', amountUsd: usd(50_000) })],
      payables: [payable({ id: 's1', reference: 'INV-0147', dueUsd: usd(126_519) })],
      proposals: [{ paymentId: 'p1', kind: 'SALE', targetId: 's1', amountUsd: usd(50_000), confidence: 80, reason: '' }],
      now,
    })
    const short = flags.find((flag) => flag.id.startsWith('short:'))
    expect(short?.headline).toContain('INV-0147 is short')
    expect(short?.detail).toContain('76,519.00 USDT is still out')
  })

  it('says when more arrived than was asked for', () => {
    const flags = flagsFor({
      payments: [payment({ id: 'p1', amountUsd: usd(60_000) })],
      payables: [payable({ id: 's1', reference: 'INV-0148', dueUsd: usd(40_000) })],
      proposals: [{ paymentId: 'p1', kind: 'SALE', targetId: 's1', amountUsd: usd(60_000), confidence: 70, reason: '' }],
      now,
    })
    expect(flags.find((flag) => flag.id.startsWith('over:'))?.headline).toContain('overpaid')
  })

  it('counts the days an invoice has been waiting with nothing against it', () => {
    const flags = flagsFor({
      payments: [],
      payables: [payable({ id: 's1', reference: 'INV-0144', dueUsd: usd(6_550), at: '2026-11-01T09:00:00Z' })],
      proposals: [],
      now,
    })
    const waiting = flags.find((flag) => flag.id.startsWith('waiting:'))
    expect(waiting?.tone).toBe('alert')
    expect(waiting?.headline).toContain('19 days')
  })

  it('is quiet about an invoice raised yesterday', () => {
    // Everything is unpaid the day it goes out. A flag on that is a flag
    // people learn to scroll past, and then they scroll past the real ones.
    const flags = flagsFor({
      payments: [],
      payables: [payable({ id: 's1', reference: 'INV-0160', dueUsd: usd(6_550), at: '2026-11-19T09:00:00Z' })],
      proposals: [],
      now,
    })
    expect(flags.find((flag) => flag.id.startsWith('waiting:'))).toBeUndefined()
  })
})

describe('nothing here can spend', () => {
  const reader = read('src/server/services/chain-reader.ts')

  it('only ever reads', () => {
    /*
     * The one property of this feature that matters more than whether it
     * reconciles correctly. There is no signing, no private key and no
     * transaction construction anywhere in the chain code — the worst a
     * compromise could achieve is reading a public ledger.
     */
    expect(reader).not.toMatch(/privateKey|private_key|mnemonic|seed phrase|sign\(/i)
    expect(reader).not.toMatch(/sendRawTransaction|eth_sendTransaction|broadcast/i)
    // And the requests it does make are GETs.
    expect(reader).not.toMatch(/method:\s*'POST'/)
  })

  it('keeps the explorer keys out of anything that renders', () => {
    const keys = read('src/server/services/explorer-keys.ts')
    expect(keys).toContain('seal(value)')
    expect(keys).toContain('hintFor')
    // The hint is the last four characters, which identifies a key and is
    // worth nothing to anybody who reads it over a shoulder.
    expect(keys).toContain('`…${key.slice(-4)}')
  })
})

describe('the days between two dates', () => {
  it('does not care which way round they are', () => {
    expect(daysApart('2026-11-10T00:00:00Z', '2026-11-12T00:00:00Z')).toBe(2)
    expect(daysApart('2026-11-12T00:00:00Z', '2026-11-10T00:00:00Z')).toBe(2)
  })
})

/**
 * What the model says, against what is actually on the board.
 *
 * Not defensive habit. A model asked to match payments to invoices will,
 * under pressure, return a well-formed pairing for an invoice that does not
 * exist — and on a reconciliation screen that is indistinguishable from a
 * real proposal, which is how wrong money gets approved by somebody who was
 * right to trust the tool.
 */
describe('checking the model’s homework', () => {
  const payments: Payment[] = [
    payment({ id: 'p1', amountUsd: usd(126_000) }),
    payment({ id: 'p2', amountUsd: usd(5_000) }),
  ]
  const payables: Payable[] = [
    payable({ id: 's1', reference: 'INV-0147', dueUsd: usd(126_519) }),
  ]

  it('takes a reading that checks out', () => {
    const reading = validate({
      links: [{
        paymentId: 'p1', invoiceId: 's1', amountUsd: usd(126_000),
        confidence: 70, reason: '126,000 is 126,519 less a 519 withdrawal fee',
      }],
      notes: ['The 5,000 looks like a deposit on something not yet invoiced.'],
    }, payments, payables)

    expect(reading.proposals).toHaveLength(1)
    expect(reading.proposals[0].targetId).toBe('s1')
    expect(reading.notes).toHaveLength(1)
  })

  it('throws away a link to an invoice that does not exist', () => {
    const reading = validate({
      links: [
        { paymentId: 'p1', invoiceId: 'INV-9999', amountUsd: usd(126_000), confidence: 95, reason: 'looks right' },
        { paymentId: 'nope', invoiceId: 's1', amountUsd: usd(1), confidence: 95, reason: 'looks right' },
      ],
      notes: [],
    }, payments, payables)
    expect(reading.proposals).toHaveLength(0)
  })

  it('will not let it spend a payment twice', () => {
    const reading = validate({
      links: [
        { paymentId: 'p2', invoiceId: 's1', amountUsd: usd(5_000), confidence: 60, reason: 'part' },
        { paymentId: 'p2', invoiceId: 's1', amountUsd: usd(5_000), confidence: 60, reason: 'part again' },
      ],
      notes: [],
    }, payments, payables)
    const total = reading.proposals.reduce((sum, p) => sum + p.amountUsd, 0)
    expect(total).toBeLessThanOrEqual(usd(5_000))
  })

  it('will not let it apply more than arrived', () => {
    const reading = validate({
      links: [{ paymentId: 'p2', invoiceId: 's1', amountUsd: usd(500_000), confidence: 90, reason: 'optimistic' }],
      notes: [],
    }, payments, payables)
    expect(reading.proposals[0]?.amountUsd).toBe(usd(5_000))
  })

  it('caps its confidence below a rule’s', () => {
    // "The model thought so" must never outrank "the figures are identical",
    // however sure the prose sounds.
    const reading = validate({
      links: [{ paymentId: 'p1', invoiceId: 's1', amountUsd: usd(126_000), confidence: 100, reason: 'certain' }],
      notes: [],
    }, payments, payables)
    expect(reading.proposals[0].confidence).toBeLessThanOrEqual(AI_CONFIDENCE_CEILING)
    expect(AI_CONFIDENCE_CEILING).toBeLessThan(80)
  })

  it('survives a reply that is nothing like the shape asked for', () => {
    expect(validate(null, payments, payables).proposals).toHaveLength(0)
    expect(validate({ links: 'yes', notes: 7 }, payments, payables).proposals).toHaveLength(0)
    expect(validate({ links: [{}, null, 3] }, payments, payables).proposals).toHaveLength(0)
  })

  it('sends figures and ids, not the customer book', () => {
    /*
     * A reconciliation needs to know that an address settled invoice 1727
     * before. It does not need anybody's email, phone or address, and sending
     * them to a third party because it was convenient is not a thing to do
     * with a customer book.
     */
    const ai = read('src/server/services/wallet-ai.ts')
    const briefing = ai.slice(ai.indexOf('function brief('), ai.indexOf('* Ask, then check'))
    // Named fields rather than the word: a wallet address is the one address
    // this is about, and a loose match on it catches its own evidence.
    for (const field of ['customerEmail', 'customerPhone', 'customerCountry', 'customerCompany']) {
      expect(briefing, `the briefing sends ${field}`).not.toContain(field)
    }
    expect(briefing).not.toMatch(/\.email|\.phone/)
    // And the payer's own address is shortened, so a screen or a log of the
    // prompt carries a recognisable stub rather than the whole thing.
    expect(briefing).toContain('shortAddress(payment.counterparty)')
  })
})

/**
 * The order the rules run in, which a proof on real rows corrected.
 *
 * The unit tests above each described one rule in isolation and all passed
 * while the passes ran in the wrong order — it took a payment and a test
 * transfer sitting in the same wallet to show it.
 */
describe('which rule gets to speak first', () => {
  it('does not let a test ping turn an exact payment into an estimate', () => {
    /*
     * 40,000 against a 40,000 invoice is the most certain thing this file can
     * say. With a one-dollar ping from the same payer in the pool, the
     * instalment rule used to get there first and propose "two payments
     * coming to 40,001" — true, useless, and less confident than the truth.
     */
    const proposals = proposeLinks(
      [
        payment({ id: 'ping', amountUsd: usd(1) }),
        payment({ id: 'real', amountUsd: usd(40_000) }),
      ],
      [payable({ id: 's1', reference: 'INV-0148', dueUsd: usd(40_000) })],
    )
    expect(proposals).toHaveLength(1)
    expect(proposals[0].paymentId).toBe('real')
    expect(proposals[0].amountUsd).toBe(usd(40_000))
    expect(proposals[0].reason).toContain('exactly')
  })

  it('still puts instalments together when no single payment fits', () => {
    const proposals = proposeLinks(
      [
        payment({ id: 'p1', amountUsd: usd(20_000) }),
        payment({ id: 'p2', amountUsd: usd(20_000) }),
      ],
      [payable({ id: 's1', reference: 'INV-0148', dueUsd: usd(40_000) })],
    )
    expect(proposals).toHaveLength(2)
    expect(proposals.reduce((sum, p) => sum + p.amountUsd, 0)).toBe(usd(40_000))
  })

  it('prefers an exact invoice over a near one', () => {
    // 40,000 is within tolerance of 40,050, and exactly 40,000 of something
    // else. Tolerance is for when there is no exact answer.
    const proposals = proposeLinks(
      [payment({ id: 'p1', amountUsd: usd(40_000) })],
      [
        payable({ id: 'near', reference: 'INV-A', dueUsd: usd(40_050), at: '2026-11-10T09:00:00Z' }),
        payable({ id: 'exact', reference: 'INV-B', dueUsd: usd(40_000), at: '2026-11-01T09:00:00Z' }),
      ],
    )
    expect(proposals[0].targetId).toBe('exact')
  })
})
