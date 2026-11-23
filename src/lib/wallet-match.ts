/**
 * Which payment settled which invoice.
 *
 * Alex: "link them to transactions accordingly and flag any other amounts
 * missing or things we should be aware of."
 *
 * All of it is here, as arithmetic over plain objects, so the rules can be
 * argued with in a test rather than discovered in production against real
 * money. Nothing in this file touches the network, the database or the clock.
 *
 * The order matters. Every rule below is tried from the most certain down,
 * and a payment stops at the first one that fits — because a weaker rule
 * finding a second answer for a payment that already has a certain one is
 * not more information, it is noise over the top of the truth.
 */

export interface Payment {
  id: string
  /** Cents. USDT is a dollar as far as the desk is concerned. */
  amountUsd: number
  /** When the chain recorded it. */
  at: string
  counterparty: string
  /** The customer this address has paid as before, where we have seen it. */
  knownCustomerId?: string | null
  /** Already settled against something, so not up for matching again. */
  linkedUsd?: number
}

export interface Payable {
  kind: 'SALE' | 'COMMISSION'
  id: string
  reference: string
  label: string
  customerId?: string | null
  customerName?: string | null
  /** The whole invoice in cents. */
  totalUsd: number
  /** What is still outstanding in cents, after anything already applied. */
  dueUsd: number
  /** The invoice date. */
  at: string
}

export interface Proposal {
  paymentId: string
  kind: 'SALE' | 'COMMISSION'
  targetId: string
  /** The part of the payment this settles, in cents. */
  amountUsd: number
  confidence: number
  reason: string
}

/**
 * How far out an amount may be and still be the same payment.
 *
 * Not network fees: a USDT transfer pays its fee in TRX or ETH, so the amount
 * that leaves is the amount that arrives. This is for the exchanges that take
 * a withdrawal fee out of the sum itself, and for the customer who rounds
 * 126,519.40 down to 126,519 because the extra forty cents is not worth the
 * typing.
 *
 * The greater of the two, so it is a sensible few dollars on a small invoice
 * and a sensible few hundred on a large one.
 */
/** A transfer this small is somebody testing the address, not paying. */
export const DUST_CEILING = 500 // five dollars, in cents

export const TOLERANCE_BPS = 25 // a quarter of one per cent
export const TOLERANCE_FLOOR = 500 // five dollars, in cents

export function tolerance(amountUsd: number): number {
  return Math.max(TOLERANCE_FLOOR, Math.round((amountUsd * TOLERANCE_BPS) / 10_000))
}

/** Whether two figures are the same money, allowing for the above. */
export function sameMoney(a: number, b: number): boolean {
  return Math.abs(a - b) <= tolerance(Math.max(a, b))
}

/**
 * How far apart a payment and an invoice may be.
 *
 * A deposit lands before the invoice is raised and a settlement lands after
 * the watch has shipped, so the window is wide on both sides. It is a
 * candidacy test, not a scoring one: being close counts towards confidence
 * further down.
 */
export const WINDOW_DAYS = 45

const DAY = 24 * 60 * 60 * 1000

export function daysApart(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / DAY
}

/** What is left of a payment once anything already linked is taken off. */
export function unapplied(payment: Payment): number {
  return Math.max(0, payment.amountUsd - (payment.linkedUsd ?? 0))
}

/**
 * The invoices a payment could plausibly be for.
 *
 * Narrow before scoring: an unpaid invoice from three years ago is not a
 * candidate for today's payment however neatly the figure happens to match,
 * and leaving it in the running is how a reconciliation tool produces a
 * confident wrong answer.
 */
export function candidates(payment: Payment, payables: Payable[]): Payable[] {
  return payables.filter(
    (payable) => payable.dueUsd > 0 && daysApart(payment.at, payable.at) <= WINDOW_DAYS,
  )
}

/**
 * Confidence, as a number somebody can argue with.
 *
 * Three things raise it: the amount being exactly right rather than nearly,
 * the payer being an address that has paid that customer's invoices before,
 * and the payment landing near the invoice date. Nothing here is magic — it
 * is written out so a wrong answer can be traced to the rule that produced
 * it rather than to a model's mood.
 */
function score(payment: Payment, payable: Payable, exact: boolean, alone: boolean): number {
  let confidence = exact ? 70 : 55
  if (alone) confidence += 12
  if (payment.knownCustomerId && payment.knownCustomerId === payable.customerId) confidence += 16
  const days = daysApart(payment.at, payable.at)
  if (days <= 2) confidence += 8
  else if (days <= 10) confidence += 4
  else if (days > 30) confidence -= 6
  return Math.max(1, Math.min(99, confidence))
}

/** Enough of an address to recognise, not enough to retype. */
function short(address: string): string {
  return address.length <= 14 ? address : `${address.slice(0, 6)}…${address.slice(-6)}`
}

function money(cents: number): string {
  return `${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
}

/**
 * One payment, one invoice, nothing left over.
 *
 * The ordinary case and the one worth getting exactly right: an invoice goes
 * out, the customer sends that figure, and the only question is which
 * invoice. Where exactly one candidate matches the amount, this is as certain
 * as reconciliation gets.
 */
function oneToOne(payment: Payment, pool: Payable[], exactOnly: boolean): Proposal[] {
  const amount = unapplied(payment)
  const exact = pool.filter((payable) => payable.dueUsd === amount)
  const near = exactOnly
    ? []
    : pool.filter((payable) => payable.dueUsd !== amount && sameMoney(payable.dueUsd, amount))

  const hits = exact.length > 0 ? exact : near
  if (hits.length === 0) return []

  // Several invoices for the same figure is the case to be careful with:
  // propose the nearest in date, and say so, rather than picking silently.
  const sorted = [...hits].sort((a, b) => daysApart(payment.at, a.at) - daysApart(payment.at, b.at))
  const best = sorted[0]
  const alone = hits.length === 1
  const isExact = exact.length > 0

  const reason = alone
    ? isExact
      ? `${money(amount)} is exactly what ${best.reference} is waiting for`
      : `${money(amount)} is within a few dollars of ${best.reference}`
    : `${hits.length} invoices are waiting for this figure — ${best.reference} is the closest in date`

  return [{
    paymentId: payment.id,
    kind: best.kind,
    targetId: best.id,
    amountUsd: Math.min(amount, best.dueUsd),
    confidence: score(payment, best, isExact, alone),
    reason,
  }]
}

/**
 * One payment covering several invoices.
 *
 * A dealer buying three watches pays once. The giveaway is that the figure
 * matches no single invoice but matches a set of them exactly — so the set is
 * only proposed when it is exact, because a near-miss over three invoices is
 * arithmetic looking for an excuse.
 *
 * Only sets from one customer, and only small ones: the number of subsets
 * grows the way subsets do, and a payment that needs five invoices to explain
 * it needs a person, not a search.
 */
function coversSeveral(payment: Payment, pool: Payable[]): Proposal[] {
  const amount = unapplied(payment)
  const byCustomer = new Map<string, Payable[]>()
  for (const payable of pool) {
    const key = payable.customerId ?? payable.customerName ?? payable.id
    byCustomer.set(key, [...(byCustomer.get(key) ?? []), payable])
  }

  for (const group of byCustomer.values()) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => b.dueUsd - a.dueUsd).slice(0, 6)

    for (let size = 2; size <= Math.min(4, sorted.length); size += 1) {
      const found = subsetSummingTo(sorted, size, amount)
      if (!found) continue
      const references = found.map((payable) => payable.reference).join(', ')
      return found.map((payable) => ({
        paymentId: payment.id,
        kind: payable.kind,
        targetId: payable.id,
        amountUsd: payable.dueUsd,
        confidence: Math.min(90, score(payment, payable, true, true) - 4),
        reason: `${money(amount)} settles ${references} together`,
      }))
    }
  }
  return []
}

/** Exhaustive over a handful of invoices, which is all this is ever given. */
function subsetSummingTo(pool: Payable[], size: number, target: number): Payable[] | null {
  const walk = (start: number, chosen: Payable[]): Payable[] | null => {
    if (chosen.length === size) {
      const total = chosen.reduce((sum, payable) => sum + payable.dueUsd, 0)
      return total === target ? chosen : null
    }
    for (let index = start; index < pool.length; index += 1) {
      const found = walk(index + 1, [...chosen, pool[index]])
      if (found) return found
    }
    return null
  }
  return walk(0, [])
}

/**
 * Several payments settling one invoice.
 *
 * The other half of the same story: a customer pays a 126,519 invoice in a
 * 50,000, a 50,000 and a 26,519 over four days, often because that is what
 * their exchange lets them move at once. Proposed as a set from one payer
 * where the set is exact.
 */
function paidInInstalments(payments: Payment[], pool: Payable[]): Proposal[] {
  const proposals: Proposal[] = []
  const byPayer = new Map<string, Payment[]>()
  for (const payment of payments) {
    if (unapplied(payment) <= 0) continue
    byPayer.set(payment.counterparty, [...(byPayer.get(payment.counterparty) ?? []), payment])
  }

  for (const group of byPayer.values()) {
    if (group.length < 2) continue
    for (const payable of pool) {
      const within = group.filter((payment) => daysApart(payment.at, payable.at) <= WINDOW_DAYS)
      if (within.length < 2) continue
      const total = within.reduce((sum, payment) => sum + unapplied(payment), 0)
      if (!sameMoney(total, payable.dueUsd)) continue

      for (const payment of within) {
        proposals.push({
          paymentId: payment.id,
          kind: payable.kind,
          targetId: payable.id,
          amountUsd: unapplied(payment),
          confidence: Math.min(88, score(payment, payable, total === payable.dueUsd, true) - 2),
          reason: `${within.length} payments from this address come to ${money(total)}, which is ${payable.reference}`,
        })
      }
      return proposals
    }
  }
  return proposals
}

/**
 * Everything the rules can say about a batch.
 *
 * Returned rather than written: every proposal goes in front of somebody
 * before it touches the ledger, which is what Alex asked for and what money
 * deserves.
 */
export function proposeLinks(payments: Payment[], payables: Payable[]): Proposal[] {
  const proposals: Proposal[] = []
  const spoken = new Set<string>()
  /*
   * A test transfer is not part of the payment.
   *
   * Sending a dollar first to check the address is the habit of everybody who
   * has ever lost a payment to a typo — and left in the pool it turns an
   * exact 40,000 against a 40,000 invoice into "two payments coming to
   * 40,001", which is true, useless, and less confident than the truth. It is
   * flagged on its own instead.
   */
  const incoming = payments.filter(
    (payment) => unapplied(payment) > 0 && payment.amountUsd > DUST_CEILING,
  )

  /*
   * The passes, strongest first, and the order is load-bearing.
   *
   * An exact figure against one waiting invoice is the most certain thing
   * this file can say, so it is said before any theory that needs several
   * payments or several invoices to work. Instalments come next, because a
   * 50,000 that is a third of an invoice would otherwise be matched against
   * whatever other 50,000 invoice happens to be open. Only then the inexact
   * readings, which are guesses wearing arithmetic.
   */
  for (const payment of incoming) {
    const pool = candidates(payment, payables)
    const found = oneToOne(payment, pool, true)
    if (found.length > 0) {
      proposals.push(...found)
      spoken.add(payment.id)
    }
  }

  const left = incoming.filter((payment) => !spoken.has(payment.id))
  for (const proposal of paidInInstalments(left, payables)) {
    proposals.push(proposal)
    spoken.add(proposal.paymentId)
  }

  for (const payment of incoming) {
    if (spoken.has(payment.id)) continue
    const pool = candidates(payment, payables)
    if (pool.length === 0) continue

    const found = oneToOne(payment, pool, false)
    if (found.length > 0) {
      proposals.push(...found)
      spoken.add(payment.id)
      continue
    }

    const several = coversSeveral(payment, pool)
    if (several.length > 0) {
      proposals.push(...several)
      spoken.add(payment.id)
    }
  }

  return proposals
}

/* -------------------------------------------------------------- flags -- */

export type FlagTone = 'alert' | 'warn' | 'info'

export interface Flag {
  id: string
  tone: FlagTone
  headline: string
  detail: string
  /** What it is about, so the screen can take somebody to it. */
  paymentId?: string
  payableId?: string
}

/** Past this, an invoice waiting with nothing against it is worth saying. */
export const OVERDUE_DAYS = 7

/**
 * What somebody should be told, beyond what matched.
 *
 * The second half of the ask, and the half that earns the feature: a
 * reconciliation tool that only reports its successes leaves the money nobody
 * has accounted for exactly where it was. Each of these is a question a
 * person would ask if they had time to read every row.
 */
export function flagsFor(input: {
  payments: Payment[]
  payables: Payable[]
  proposals: Proposal[]
  /** Addresses that are ours, so a move between our own wallets is not income. */
  ourAddresses?: string[]
  /** Addresses seen before this batch, so a new payer can be called new. */
  knownAddresses?: string[]
  /** Today, passed in rather than read, so this stays testable. */
  now: string
}): Flag[] {
  const flags: Flag[] = []
  const ours = new Set((input.ourAddresses ?? []).map((address) => address.toLowerCase()))
  const known = new Set((input.knownAddresses ?? []).map((address) => address.toLowerCase()))
  const matched = new Set(input.proposals.map((proposal) => proposal.paymentId))

  const appliedTo = new Map<string, number>()
  for (const proposal of input.proposals) {
    appliedTo.set(proposal.targetId, (appliedTo.get(proposal.targetId) ?? 0) + proposal.amountUsd)
  }

  for (const payment of input.payments) {
    const address = payment.counterparty.toLowerCase()

    if (ours.has(address)) {
      flags.push({
        id: `internal:${payment.id}`,
        tone: 'info',
        paymentId: payment.id,
        headline: `${money(payment.amountUsd)} moved between our own wallets`,
        detail: `From ${short(payment.counterparty)}, which is also ours. Nothing to reconcile — set it aside so it stops asking.`,
      })
      continue
    }

    if (payment.amountUsd <= DUST_CEILING) {
      flags.push({
        id: `dust:${payment.id}`,
        tone: 'info',
        paymentId: payment.id,
        headline: `${money(payment.amountUsd)} — a test transfer, most likely`,
        detail: `${short(payment.counterparty)} checking the address works before sending the real figure. Expect the rest shortly.`,
      })
      continue
    }

    if (!matched.has(payment.id) && unapplied(payment) > 0) {
      flags.push({
        id: `unmatched:${payment.id}`,
        tone: 'alert',
        paymentId: payment.id,
        headline: `${money(unapplied(payment))} arrived that nothing accounts for`,
        detail: `From ${short(payment.counterparty)} on ${payment.at.slice(0, 10)}. No invoice is waiting for that figure — either it is one nobody raised, or a deposit on something not yet sold.`,
      })
    }

    if (!known.has(address) && !ours.has(address)) {
      flags.push({
        id: `new-payer:${payment.id}`,
        tone: 'warn',
        paymentId: payment.id,
        /*
         * Named and priced, because three of these in a row saying the same
         * sentence is a flag people learn to scroll past — and then they
         * scroll past the one that mattered.
         */
        headline: `${money(payment.amountUsd)} from an address we have not been paid from before`,
        detail: `${short(payment.counterparty)}, on ${payment.at.slice(0, 10)}. Worth a look before it is taken as settled.`,
      })
    }
  }

  for (const payable of input.payables) {
    const applied = appliedTo.get(payable.id) ?? 0
    const outstanding = payable.dueUsd - applied

    if (applied > 0 && outstanding > tolerance(payable.totalUsd)) {
      flags.push({
        id: `short:${payable.id}`,
        tone: 'warn',
        payableId: payable.id,
        headline: `${payable.reference} is short`,
        detail: `${money(applied)} has arrived against ${money(payable.dueUsd)}. ${money(outstanding)} is still out.`,
      })
    }

    if (applied > 0 && applied - payable.dueUsd > tolerance(payable.totalUsd)) {
      flags.push({
        id: `over:${payable.id}`,
        tone: 'warn',
        payableId: payable.id,
        headline: `${payable.reference} has been overpaid`,
        detail: `${money(applied)} against ${money(payable.dueUsd)}. Either something else is being settled with it, or it goes back.`,
      })
    }

    if (applied === 0 && daysApart(input.now, payable.at) >= OVERDUE_DAYS) {
      flags.push({
        id: `waiting:${payable.id}`,
        tone: 'alert',
        payableId: payable.id,
        headline: `${payable.reference} has been waiting ${Math.floor(daysApart(input.now, payable.at))} days`,
        detail: `${money(payable.dueUsd)} with nothing on the chain against it. Paid another way, or not paid.`,
      })
    }
  }

  const order: Record<FlagTone, number> = { alert: 0, warn: 1, info: 2 }
  return flags.sort((a, b) => order[a.tone] - order[b.tone])
}
