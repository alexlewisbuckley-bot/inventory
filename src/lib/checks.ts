import type {
  EntityType, IdCheckStatus, RegisterCheckStatus, VatCheckStatus,
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

/**
 * How long identifying a director stays good for.
 *
 * Counted in calendar months rather than in days, because six months is what
 * was asked for and 180 days is not six months — it drifts by up to three days
 * a year, which is exactly the kind of quiet inaccuracy a compliance date
 * should not have.
 */
export const ID_VALIDITY_MONTHS = 6

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

/**
 * The same calendar day, n months on.
 *
 * Clamped to the end of the month, so a check made on 31 August falls due on
 * 28 February rather than rolling forward into March — the direction that
 * matters, since the other way round would leave a lapsed check looking
 * current for three days.
 */
export function addMonths(value: Date | string | null | undefined, months: number): Date | null {
  const date = asDate(value)
  if (!date) return null
  const day = date.getUTCDate()
  const shifted = new Date(date.getTime())
  shifted.setUTCDate(1)
  shifted.setUTCMonth(shifted.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate()
  shifted.setUTCDate(Math.min(day, lastDay))
  return shifted
}

/** When the director's identification falls due again, or null if never done. */
export function idRecheckDueAt(checkedAt: Date | string | null | undefined): Date | null {
  return addMonths(checkedAt, ID_VALIDITY_MONTHS)
}

export interface IdCheckFacts {
  directorName: string | null
  idCheckStatus: IdCheckStatus
  idCheckedAt: Date | string | null
  /** The expiry of the document the check was made against, where it has one. */
  idDocumentExpiresOn: Date | string | null
}

/**
 * Whether the person behind the supplier has been identified, and recently.
 *
 * Three separate things have to hold, and each fails differently:
 *
 *  - somebody is named as the director,
 *  - a document was seen and accepted, within the last six months,
 *  - that document has not itself expired since.
 *
 * The last is the one that is easy to miss, and it is why the document's
 * expiry is carried on the check. A verification made five months ago against
 * a passport that ran out last week is in date and worthless; without this it
 * would show green until the day the check lapsed.
 */
export function idCheckState(facts: IdCheckFacts, now: Date = new Date()): CheckState {
  if (facts.idCheckStatus === 'REJECTED') {
    return { tone: 'RED', label: 'ID rejected', detail: 'The identity document offered for this supplier was not accepted. Do not trade with them until somebody has resolved it.' }
  }

  if (!facts.directorName) {
    return { tone: 'AMBER', label: 'No director named', detail: 'Nobody is recorded as the director of this supplier, so there is no person to identify. Add them to the supplier record.' }
  }

  if (facts.idCheckStatus !== 'VERIFIED') {
    return { tone: 'AMBER', label: 'ID not checked', detail: `No identity document has been checked for ${facts.directorName}. Attach one to the supplier record and record the check.` }
  }

  // An expired passport is not identification, whatever the check said.
  const expiry = asDate(facts.idDocumentExpiresOn)
  if (expiry && expiry.getTime() < now.getTime()) {
    return { tone: 'RED', label: 'ID expired', detail: `The identity document ${facts.directorName} was identified from expired on ${expiry.toISOString().slice(0, 10)}. It is no longer identification — a current one is needed.` }
  }

  const dueAt = idRecheckDueAt(facts.idCheckedAt)
  if (!dueAt) {
    return { tone: 'AMBER', label: 'Re-check due', detail: 'This supplier was verified, but not when. Record the check again to put a date on it.' }
  }
  if (dueAt.getTime() < now.getTime()) {
    const age = daysSince(facts.idCheckedAt, now)
    return { tone: 'AMBER', label: 'Re-check due', detail: `${facts.directorName} was identified ${age} days ago. Identification lasts ${ID_VALIDITY_MONTHS} months, so it is due again.` }
  }

  return {
    tone: 'GREEN',
    label: 'ID verified',
    detail: `${facts.directorName} identified from the document on file. Due again ${dueAt.toISOString().slice(0, 10)}.`,
  }
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
  /** The director behind the supplier, identified. */
  id: CheckState
  register: CheckState
  /** The worst of the three: what the watch shows in a list. */
  tone: CheckTone
  /** What that colour is about, when it is not green. */
  summary: string
}

/**
 * Every check for one watch.
 *
 * Two of the three belong to the supplier rather than to the watch, so every
 * watch bought from a supplier whose VAT check has lapsed or whose director is
 * unidentified goes amber at once. That is the intended behaviour: the
 * exposure is per-watch even though the fault is per-supplier, and a list of
 * suppliers to chase does not tell you which stock is affected.
 */
export function watchChecks(
  facts: VatCheckFacts & IdCheckFacts & RegisterCheckFacts,
  now: Date = new Date(),
): WatchChecks {
  const vat = vatCheckState(facts, now)
  const id = idCheckState(facts, now)
  const register = registerCheckState(facts, now)
  const tone = worstTone(vat.tone, id.tone, register.tone)

  // The register first, then identity, then VAT — the summary is what a person
  // reads instead of opening the record, so when several are equally bad it
  // leads with the one that stops a sale rather than the one that delays a
  // reclaim.
  const worst = [register, id, vat].filter((state) => state.tone === tone)
  const summary = tone === 'GREEN'
    ? 'Supplier identified and VAT confirmed; the serial is clear.'
    : worst.map((state) => state.label).join(' · ')

  return { vat, id, register, tone, summary }
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
