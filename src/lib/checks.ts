import type {
  EntityType, RegisterCheckStatus, VatCheckStatus,
} from './enums'

/**
 * The two compliance checks, reduced to a colour.
 *
 * Pure and shared: the server decides nothing here that the browser cannot
 * re-derive, which is what lets the same rule drive a chip in a table row, a
 * card on the detail page and a "what is overdue" query without three
 * definitions of "green" drifting apart.
 *
 * Green is a positive answer that is still current. Amber is the absence of an
 * answer — nobody has asked, or the answer has gone stale. Red is a negative
 * answer: somebody asked and was told no. The distinction between amber and
 * red is the one that matters operationally, because amber is work to do and
 * red is a reason to stop.
 */

export type CheckTone = 'GREEN' | 'AMBER' | 'RED'

export interface CheckState {
  tone: CheckTone
  /** Two or three words, for a chip. */
  label: string
  /** One sentence saying what it means and, when amber or red, what to do. */
  detail: string
}

/**
 * How long a VAT check stays good for.
 *
 * A VAT registration can be cancelled on any day of the year, and HMRC does
 * not tell you when one of your suppliers deregisters — so the only thing an
 * old answer proves is that the supplier was registered on the day you asked.
 * Ninety days is the operator's chosen cadence.
 */
export const VAT_RECHECK_DAYS = 90

const asDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Whole days elapsed, or null when it never happened. */
export function daysSince(value: Date | string | null | undefined, now: Date = new Date()): number | null {
  const date = asDate(value)
  if (!date) return null
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000)
}

/** When the next VAT check falls due, or null when none has been made. */
export function vatRecheckDueAt(checkedAt: Date | string | null | undefined): Date | null {
  const date = asDate(checkedAt)
  return date ? new Date(date.getTime() + VAT_RECHECK_DAYS * 86_400_000) : null
}

export interface VatCheckFacts {
  vatNo: string | null
  entityType: EntityType
  vatCheckStatus: VatCheckStatus
  vatCheckedAt: Date | string | null
}

/**
 * The supplier's VAT standing, as of now.
 *
 * Note the order: whether there is a number to check comes before what the
 * last check said. A supplier whose VAT number has been removed since it was
 * last checked has nothing to be green about, and reporting a months-old
 * "registered" against a blank field is how a stale answer outlives the fact
 * it described.
 */
export function vatCheckState(facts: VatCheckFacts, now: Date = new Date()): CheckState {
  if (!facts.vatNo) {
    // Not a fault in itself. A private individual selling their own watch has
    // no VAT number and never will, and saying "missing" about it every time
    // trains people to ignore the colour.
    return facts.entityType === 'PRIVATE_SELLER'
      ? { tone: 'AMBER', label: 'Not VAT registered', detail: 'A private seller has no VAT number, so there is nothing to check. Keep the purchase paperwork instead.' }
      : { tone: 'AMBER', label: 'No VAT number', detail: 'No VAT number is recorded for this supplier, so it cannot be checked against HMRC. Add it to the supplier record.' }
  }

  switch (facts.vatCheckStatus) {
    case 'NOT_FOUND':
      return { tone: 'RED', label: 'Not registered', detail: `HMRC holds no VAT registration for ${facts.vatNo}. Do not reclaim VAT on their invoices until this is resolved with the supplier.` }

    case 'MALFORMED':
      return { tone: 'RED', label: 'Invalid number', detail: `${facts.vatNo} fails its own check digits, so it cannot be a real UK VAT number. It has most likely been mistyped or misread off an invoice.` }

    case 'REGISTERED': {
      const age = daysSince(facts.vatCheckedAt, now)
      if (age === null) {
        // Registered with no date is data from before this was tracked.
        return { tone: 'AMBER', label: 'Re-check due', detail: 'This supplier was confirmed registered, but not when. Run the check to put a date on it.' }
      }
      if (age > VAT_RECHECK_DAYS) {
        return { tone: 'AMBER', label: 'Re-check due', detail: `Confirmed registered with HMRC ${age} days ago. Checks expire after ${VAT_RECHECK_DAYS} days, so this one is due again.` }
      }
      return {
        tone: 'GREEN',
        label: 'Registered',
        detail: age === 0
          ? 'Confirmed registered with HMRC today.'
          : `Confirmed registered with HMRC ${age} ${age === 1 ? 'day' : 'days'} ago. Due again in ${VAT_RECHECK_DAYS - age} days.`,
      }
    }

    case 'UNAVAILABLE':
      // Amber, not red. HMRC being down says nothing whatsoever about the
      // supplier, and colouring an outage the same as a failed lookup would
      // put a supplier in the danger column for somebody else's downtime.
      return { tone: 'AMBER', label: 'Could not check', detail: 'HMRC could not be reached the last time this was asked. It says nothing about the supplier — try again.' }

    case 'UNCHECKED':
    default:
      return { tone: 'AMBER', label: 'Not checked', detail: `${facts.vatNo} has not been checked against HMRC yet.` }
  }
}

export interface RegisterCheckFacts {
  serial: string | null
  registerCheckStatus: RegisterCheckStatus
  registerCheckedAt: Date | string | null
}

/**
 * Whether this specific watch has been searched against The Watch Register.
 *
 * No expiry, deliberately, unlike the VAT check: this is a search of a
 * database of reports, and it is done once per watch at intake. The register
 * check that would go stale is a different check — re-searching before sale —
 * and is not what has been asked for here.
 */
export function registerCheckState(facts: RegisterCheckFacts, now: Date = new Date()): CheckState {
  // A recorded hit stands whatever else is true of the record.
  if (facts.registerCheckStatus === 'RECORDED') {
    return { tone: 'RED', label: 'On the register', detail: 'This serial is recorded on The Watch Register as lost or stolen. Do not sell it. Take advice before doing anything else with it.' }
  }

  // Derived from the serial rather than read from the stored status, so that
  // filling in a serial afterwards turns the light amber-for-work rather than
  // leaving it parked on "nothing to check".
  if (!facts.serial) {
    return { tone: 'AMBER', label: 'No serial to check', detail: 'The Watch Register is searched by serial number, and none is recorded for this item. Add the serial, then run the check.' }
  }

  if (facts.registerCheckStatus === 'CLEAR') {
    const age = daysSince(facts.registerCheckedAt, now)
    return {
      tone: 'GREEN',
      label: 'Clear',
      detail: age === null
        ? 'Searched against The Watch Register with no match.'
        : `Searched against The Watch Register ${age === 0 ? 'today' : `${age} ${age === 1 ? 'day' : 'days'} ago`} with no match.`,
    }
  }

  return { tone: 'AMBER', label: 'Not checked', detail: `Serial ${facts.serial} has not been searched against The Watch Register.` }
}

const RANK: Record<CheckTone, number> = { GREEN: 0, AMBER: 1, RED: 2 }

/** The worse of several lights — a watch is only as clear as its weakest check. */
export function worstTone(...tones: CheckTone[]): CheckTone {
  return tones.reduce((worst, tone) => (RANK[tone] > RANK[worst] ? tone : worst), 'GREEN' as CheckTone)
}

export interface WatchChecks {
  vat: CheckState
  register: CheckState
  /** The worse of the two: what the watch shows in a list. */
  tone: CheckTone
  /** What that colour is about, when it is not green. */
  summary: string
}

/**
 * Both checks for one watch.
 *
 * The VAT half belongs to the supplier, not the watch, so every watch bought
 * from a supplier with a lapsed check goes amber at once. That is the intended
 * behaviour: the exposure is per-watch even though the fault is per-supplier.
 */
export function watchChecks(
  facts: VatCheckFacts & RegisterCheckFacts,
  now: Date = new Date(),
): WatchChecks {
  const vat = vatCheckState(facts, now)
  const register = registerCheckState(facts, now)
  const tone = worstTone(vat.tone, register.tone)

  // Red first, then whichever is amber — the summary is what a person reads
  // instead of opening the record, so it has to name the worst thing.
  const worst = [register, vat].filter((state) => state.tone === tone)
  const summary = tone === 'GREEN'
    ? 'Supplier VAT confirmed and the serial is clear.'
    : worst.map((state) => state.label).join(' · ')

  return { vat, register, tone, summary }
}

/** The Chip tone each traffic light renders as. */
export const CHECK_TONE_CHIP: Record<CheckTone, 'good' | 'warning' | 'critical'> = {
  GREEN: 'good',
  AMBER: 'warning',
  RED: 'critical',
}

export const CHECK_TONE_LABELS: Record<CheckTone, string> = {
  GREEN: 'Clear',
  AMBER: 'Needs attention',
  RED: 'Problem',
}
