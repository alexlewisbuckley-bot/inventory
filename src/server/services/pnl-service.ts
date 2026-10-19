import {
  commissionForMonth, commissionOn, tradingForMonth, unattributedForMonth,
} from '../repositories/sale-repository'
import { overheadsInMonth } from '../repositories/overhead-repository'
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
    /** Running costs charged to this month. Zero means the rent is not in. */
    overheadCount: number
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

  const [trading, people, costs, unattributed] = await Promise.all([
    tradingForMonth(from, to),
    commissionForMonth(from, to),
    overheadsInMonth(monthStart, monthEnd),
    unattributedForMonth(from, to),
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
  const netProfit = trading.grossProfit - totalCosts

  return {
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
