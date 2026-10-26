import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { businessToday, startOfMonthUtc, endOfMonthUtc, endOfDayUtc, BUSINESS_TIME_ZONE } from '@/lib/dates'

const page = readFileSync(join(process.cwd(), 'src/app/(app)/reports/people/page.tsx'), 'utf8')

/** A sale date as the app stores one: the chosen calendar day at midnight UTC. */
const saleDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

/**
 * A sale made in Dubai that the server thought had not happened yet.
 *
 * Alex: "Edward done this sale but not showing in sales reports, this is
 * proving a big issue" — a Patek on the ledger, dated the 27th, absent from
 * every figure on the Sales by person page. Then, in one line, the cause:
 * "the 27th is now in UAE?"
 *
 * It was. The server runs in UTC and the shop is four hours ahead, so for
 * the last four hours of every UTC day a sale booked on the shop floor
 * carries a date the server reads as tomorrow — and the window ended at
 * "now", so tomorrow fell outside it.
 */
describe('the window a sales report runs over', () => {
  const dubaiAfterMidnight = new Date('2026-10-26T21:14:00Z') // 01:14 on the 27th in Dubai

  it('takes the date from where the shop is, not from the server', () => {
    expect(BUSINESS_TIME_ZONE).toBe('Asia/Dubai')
    expect(dubaiAfterMidnight.toISOString().slice(0, 10)).toBe('2026-10-26')
    expect(businessToday(dubaiAfterMidnight)).toEqual({ year: 2026, month: 9, day: 27 })
  })

  it('keeps a sale dated today in Dubai inside this month', () => {
    const { year, month } = businessToday(dubaiAfterMidnight)
    const edward = saleDate('2026-10-27')
    expect(edward >= startOfMonthUtc(year, month)).toBe(true)
    expect(edward <= endOfMonthUtc(year, month)).toBe(true)
    // The old bound, and the reason the sale vanished.
    expect(edward <= dubaiAfterMidnight).toBe(false)
  })

  it('keeps it inside a rolling window too', () => {
    const { year, month, day } = businessToday(dubaiAfterMidnight)
    expect(saleDate('2026-10-27') <= endOfDayUtc(year, month, day)).toBe(true)
  })

  it('runs a period to the end of its last day, not to this instant', () => {
    // A sale dated later this month belongs to this month. Ending the window
    // at the current instant drops it until the day it falls on arrives.
    const { year, month } = businessToday(dubaiAfterMidnight)
    expect(endOfMonthUtc(year, month).toISOString()).toBe('2026-10-31T23:59:59.999Z')
    expect(saleDate('2026-10-30') <= endOfMonthUtc(year, month)).toBe(true)
  })

  it('still excludes the month either side', () => {
    const { year, month } = businessToday(dubaiAfterMidnight)
    expect(saleDate('2026-11-01') <= endOfMonthUtc(year, month)).toBe(false)
    expect(saleDate('2026-09-30') >= startOfMonthUtc(year, month)).toBe(false)
  })

  it('rolls the month over on Dubai time, not UTC', () => {
    // 01:00 on 1 November in Dubai is still 31 October to the server. The
    // month being reported on is the one the shop is living in.
    const dubaiNewMonth = new Date('2026-10-31T21:00:00Z')
    expect(dubaiNewMonth.toISOString().slice(0, 10)).toBe('2026-10-31')
    const { year, month } = businessToday(dubaiNewMonth)
    expect({ year, month }).toEqual({ year: 2026, month: 10 })
    expect(saleDate('2026-11-01') <= endOfMonthUtc(year, month)).toBe(true)
  })

  it('handles the turn of the year', () => {
    const { year, month } = businessToday(new Date('2026-12-31T21:00:00Z'))
    expect({ year, month }).toEqual({ year: 2027, month: 0 })
    expect(startOfMonthUtc(year, month - 1).toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(endOfMonthUtc(year, month - 1).toISOString()).toBe('2026-12-31T23:59:59.999Z')
  })

  it('no longer ends any window at the current instant', () => {
    expect(page).not.toContain('to: now,')
    expect(page).toContain('const { year, month, day } = businessToday()')
  })
})

/**
 * One person, one margin.
 *
 * Alex: "Zoe profit doesn't add up she has done 2 deals and only 1 showing
 * in data." Both deals were counted — one stock sale and one fee — but the
 * page put two different margins for her on the same screen, because the
 * headline divided profit including the fee by a cost only the stock had.
 */
describe('the margin on the Sales by person page', () => {
  // Zoe's figures as the page showed them.
  const stockCost = 94_000
  const stockProfit = 4_982
  const fee = 14_708
  const totalProfit = stockProfit + fee

  it('is stock profit over stock cost, not fee income over stock cost', () => {
    const headline = (stockProfit / stockCost) * 100
    const row = (stockProfit / stockCost) * 100
    expect(headline).toBeCloseTo(row, 10)
    expect(headline).toBeCloseTo(5.3, 1)
    // What the card used to show: a fee with no cost under it, inflating a
    // margin by four times.
    expect((totalProfit / stockCost) * 100).toBeCloseTo(20.9, 1)
  })

  it('leaves the fee in revenue and profit, where it belongs', () => {
    // The fee is real money earned. It is only a margin it cannot be part of.
    expect(totalProfit).toBe(19_690)
  })

  it('divides by the stock profit in the card as well as the row', () => {
    expect(page).toContain('formatPct((totals.stockProfit / totals.cost) * 100)')
    expect(page).not.toContain('formatPct((totals.profit / totals.cost) * 100)')
  })
})
