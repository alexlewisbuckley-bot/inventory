import {
  commissionOn, tradingForMonth, unattributedForMonth,
} from '../repositories/sale-repository'
import { overheadCoverage, overheadsInMonth } from '../repositories/overhead-repository'
import { brokerageTotals, commissionBaseForMonth } from './brokerage-service'
import type { OverheadCadence, OverheadCategory } from '@/lib/enums'

export interface OverheadLine {
  id: string
  name: string
  category: OverheadCategory
  cadence: OverheadCadence
  /** What the invoice says, per occurrence. */
  amount: number
  /** What it works out at for this month. */
  monthly: number
}

export interface PnlMonth {
  /** Trading, on the accrual basis: invoiced in this month, paid or not. */
  invoiced: number
  costOfStock: number
  grossProfit: number
  /** Fees earned selling other people's watches. Income, not trading. */
  brokerage: number
  brokerageCount: number
  saleCount: number
  /** Of that invoiced figure, what has actually been settled. */
  received: number
  unpaid: number

  /** Wages, read from Sales people so they cannot be typed twice. */
  retainers: number
  /**
   * Commission on the whole month's profit, matching the revenue line above
   * it rather than the cash.
   */
  commission: number
  /** Of that, what is payable now — the figure the commission report shows. */
  commissionPayable: number

  overheadLines: OverheadLine[]
  overheads: number

  totalCosts: number
  netProfit: number
  /** Net profit as basis points of revenue. Null when nothing was invoiced. */
  netMarginBps: number | null

  /**
   * What the figures above could not see.
   *
   * A profit and loss built on blanks still prints a number, and the number
   * is always too good: a cost nobody entered is a cost this cannot charge.
   * These three say which inputs were missing so the bottom line can be read
   * for what it is rather than taken on trust.
   */
  blindSpots: {
    /** Sales with no salesperson on them, so no commission was charged. */
    unattributed: { count: number; profit: number }
    /** Active salespeople whose retainer is still zero. */
    peopleWithoutRetainer: number
    /** Of how many altogether. */
    peopleTotal: number
    /** Running costs charged to this month. */
    overheadCount: number
    /** How many exist at all, which is not the same number. */
    overheadsRecorded: number
    /**
     * Costs entered correctly whose first month has not come round yet.
     *
     * The case that started this: a rent dated to begin next month is a real
     * cost this month charges nothing for, and the only sign of it was a dash
     * in a table nobody reading a profit figure would open.
     */
    startingLater: Array<{ name: string; startsOn: string }>
  }
}

/**
 * One month of the business, from what was invoiced down to what was left.
 *
 * Gross profit has always been in this system and net profit never has,
 * because the rent was not. The difference between the two is the whole
 * question of whether a month was any good.
 *
 * Three sources, deliberately: what was sold comes from the sales ledger,
 * what the sales floor costs comes from Sales people, and everything else
 * is typed into Running costs. Nothing is entered in two places, so no two
 * screens can disagree about the same wage.
 */
export async function profitAndLoss(from: Date, to: Date): Promise<PnlMonth> {
  const monthStart = isoDate(from)
  const monthEnd = isoDate(to)

  const [trading, people, costs, unattributed, coverage, brokered] = await Promise.all([
    tradingForMonth(from, to),
    // Includes brokerage, so the commission charged here is the commission
    // the report pays out.
    commissionBaseForMonth(from, to),
    overheadsInMonth(monthStart, monthEnd),
    unattributedForMonth(from, to),
    overheadCoverage(monthStart, monthEnd),
    brokerageTotals(from, to),
  ])

  const retainers = people.reduce((sum, person) => sum + person.retainer, 0)

  /**
   * Commission is charged against the month that earned it, not the month
   * the customer happens to pay in.
   *
   * The commission report counts only settled invoices, because that is
   * what somebody is owed today. A profit and loss has already counted the
   * revenue from the unsettled ones a few lines above, so leaving the
   * commission on them out would overstate the month. Both figures are
   * returned and the page says which is which, since two numbers called
   * "commission" that differ is exactly the sort of thing that gets read as
   * a bug.
   *
   * What is summed is the part due *above* each retainer. The retainers are
   * their own line a few lines down, and the retainer is an advance against
   * the same quarter — so adding the whole quarter here would charge the
   * business twice for the money it has already paid out.
   */
  const commission = people.reduce((sum, person) => sum
    + commissionOn(Number(person.paidProfit) + Number(person.pendingProfit), person.retainer, person.commissionBps).commission, 0)
  const commissionPayable = people.reduce((sum, person) => sum
    + commissionOn(Number(person.paidProfit), person.retainer, person.commissionBps).commission, 0)

  const overheads = costs.reduce((sum, cost) => sum + cost.monthly, 0)
  const totalCosts = retainers + commission + overheads
  /*
   * Fees are income, not trading revenue.
   *
   * Nothing was bought and nothing left the shelf, so a brokered deal has
   * no cost of stock and no margin, and folding it into the trading lines
   * would quietly inflate both. It is added after gross profit, on its own
   * line, which is also where somebody reading this would look for it.
   */
  const netProfit = trading.grossProfit + brokered.total - totalCosts

  return {
    brokerage: brokered.total,
    brokerageCount: brokered.count,
    invoiced: trading.invoiced,
    costOfStock: trading.costOfStock,
    grossProfit: trading.grossProfit,
    saleCount: trading.count,
    received: trading.received,
    unpaid: trading.unpaid,
    retainers,
    commission,
    commissionPayable,
    overheadLines: costs.map((cost) => ({
      id: cost.id,
      name: cost.name,
      category: cost.category,
      cadence: cost.cadence,
      amount: cost.amount,
      monthly: cost.monthly,
    })),
    overheads,
    totalCosts,
    netProfit,
    netMarginBps: trading.invoiced > 0
      ? Math.round((netProfit / trading.invoiced) * 10_000)
      : null,
    blindSpots: {
      unattributed,
      peopleWithoutRetainer: people.filter((person) => person.retainer === 0).length,
      peopleTotal: people.length,
      overheadCount: costs.length,
      overheadsRecorded: coverage.recorded,
      startingLater: coverage.startingLater,
    },
  }
}

/**
 * A plain `YYYY-MM-DD`, built from the local parts rather than through
 * `toISOString`, which converts to UTC and can hand back the last day of
 * the previous month for anywhere east of Greenwich — Dubai included.
 */
export function isoDate(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-')
}
