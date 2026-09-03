import { checkVatFormat, normaliseVatNumber } from '@/lib/vat'
import { logger } from '@/lib/logger'

/**
 * Checking a VAT number against HMRC.
 *
 * The checksum in `@/lib/vat` says whether a number is well-formed. This says
 * whether it is real and whose it is, which only HMRC can answer.
 *
 * Optional in exactly the way the invoice reader's API key is optional: with
 * no credentials configured the checksum still runs and the answer is
 * "unchecked", not an error. Nothing here is allowed to fail an intake — a
 * supplier's VAT number being unverifiable is not a reason to refuse the
 * watches on their invoice.
 *
 * ## Credentials
 *
 * `HMRC_CLIENT_ID` and `HMRC_CLIENT_SECRET`, from an application created on
 * the HMRC Developer Hub. Sandbox credentials are issued immediately and
 * return synthetic data; production credentials are a separate request made
 * after testing in the sandbox. `HMRC_VAT_API_BASE` selects which:
 *
 *   sandbox     https://test-api.service.hmrc.gov.uk   (the default)
 *   production  https://api.service.hmrc.gov.uk
 *
 * ## Written against the documentation, not against the API
 *
 * The endpoint, the client-credentials flow and the response shape below come
 * from HMRC's published documentation; no call has been made to verify them,
 * because the network this was built on cannot reach HMRC and no credentials
 * existed yet. The parsing is therefore forgiving and every failure is
 * reported with its status and body rather than swallowed — the first real
 * call should say precisely what is wrong rather than merely not working.
 */

export type VatCheckStatus =
  /** HMRC confirmed the number is registered. */
  | 'REGISTERED'
  /** HMRC has no such registration. */
  | 'NOT_FOUND'
  /** Well-formed, but nothing asked HMRC — no credentials configured. */
  | 'UNCHECKED'
  /** The number cannot be right: it fails its own check digits. */
  | 'MALFORMED'
  /** HMRC was asked and could not answer. */
  | 'UNAVAILABLE'

export interface VatCheckResult {
  status: VatCheckStatus
  vatNumber: string | null
  /** The registered name HMRC holds, when it answered. */
  name: string | null
  /** The registered address, flattened for display. */
  address: string | null
  /** HMRC's proof-of-check reference, when a requester VRN was supplied. */
  consultationNumber: string | null
  /** Always safe to show a person. */
  message: string | null
}

const SANDBOX = 'https://test-api.service.hmrc.gov.uk'

const base = (): string => (process.env.HMRC_VAT_API_BASE?.trim() || SANDBOX).replace(/\/+$/, '')

export function hmrcConfigured(): boolean {
  return Boolean(process.env.HMRC_CLIENT_ID && process.env.HMRC_CLIENT_SECRET)
}

/**
 * The application's access token, kept until it expires.
 *
 * HMRC issues these for four hours. Fetching one per lookup would triple the
 * calls and the latency for no benefit; module scope is the right lifetime
 * because a serverless instance that survives long enough to reuse it is
 * exactly the instance that would otherwise re-fetch it.
 */
let cached: { token: string; expiresAt: number } | null = null

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  const response = await fetch(`${base()}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.HMRC_CLIENT_ID!,
      client_secret: process.env.HMRC_CLIENT_SECRET!,
      // Overridable because the exact scope string is the detail most likely
      // to differ from what the documentation implied.
      scope: process.env.HMRC_VAT_API_SCOPE?.trim() || 'read:vat-registered-companies',
    }),
  })

  if (!response.ok) {
    throw new Error(`token request failed (${response.status}): ${(await response.text()).slice(0, 200)}`)
  }

  const body = await response.json() as { access_token?: string; expires_in?: number }
  if (!body.access_token) throw new Error('token request returned no access_token')

  cached = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 14_400) * 1000,
  }
  return cached.token
}

const unchecked = (vatNumber: string | null, message: string | null): VatCheckResult => ({
  status: 'UNCHECKED', vatNumber, name: null, address: null, consultationNumber: null, message,
})

/**
 * Check a VAT number, as far as is possible right now.
 *
 * `requesterVrn` is your own VAT number. Supplying it makes HMRC return a
 * consultation number — a dated reference proving the check was made, which is
 * the thing worth keeping if a registration is ever disputed.
 */
export async function checkVatNumber(
  raw: string | null | undefined,
  requesterVrn?: string | null,
): Promise<VatCheckResult> {
  const format = checkVatFormat(raw)

  if (format.status === 'ABSENT') {
    return { status: 'UNCHECKED', vatNumber: null, name: null, address: null, consultationNumber: null, message: null }
  }
  if (format.status !== 'VALID') {
    // No point asking HMRC about a number that cannot exist.
    return {
      status: 'MALFORMED',
      vatNumber: format.normalised,
      name: null,
      address: null,
      consultationNumber: null,
      message: format.message,
    }
  }

  const vatNumber = format.normalised!
  if (!hmrcConfigured()) {
    // Deliberately silent. "Not checked against HMRC" on every invoice is a
    // notice nobody reads, and it would be on every invoice until credentials
    // exist. The status still says so for anything that wants to know.
    return unchecked(vatNumber, null)
  }

  try {
    const requester = normaliseVatNumber(requesterVrn)
    const path = requester
      ? `/organisations/vat/check-vat-number/lookup/${vatNumber}/${requester}`
      : `/organisations/vat/check-vat-number/lookup/${vatNumber}`

    const response = await fetch(`${base()}${path}`, {
      headers: {
        Accept: 'application/vnd.hmrc.2.0+json',
        Authorization: `Bearer ${await accessToken()}`,
      },
      // Well under the serverless ceiling: a slow check must never be the
      // reason an invoice fails to book in.
      signal: AbortSignal.timeout(8_000),
    })

    if (response.status === 404) {
      return {
        status: 'NOT_FOUND',
        vatNumber,
        name: null,
        address: null,
        consultationNumber: null,
        message: `HMRC holds no registration for ${vatNumber}.`,
      }
    }

    if (!response.ok) {
      const body = (await response.text()).slice(0, 200)
      logger.warn('hmrc vat lookup failed', { vatNumber, status: response.status, body })
      return {
        status: 'UNAVAILABLE',
        vatNumber,
        name: null,
        address: null,
        consultationNumber: null,
        message: `HMRC could not be asked (${response.status}): ${body}`,
      }
    }

    const body = await response.json() as {
      target?: { name?: string; address?: Record<string, string | undefined> }
      consultationNumber?: string
    }

    const address = body.target?.address
      ? Object.entries(body.target.address)
        .filter(([key, value]) => value && key !== 'countryCode')
        .map(([, value]) => value)
        .join(', ')
      : null

    return {
      status: 'REGISTERED',
      vatNumber,
      name: body.target?.name ?? null,
      address: address || null,
      consultationNumber: body.consultationNumber ?? null,
      message: null,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    logger.warn('hmrc vat lookup threw', { vatNumber, error: detail })
    return {
      status: 'UNAVAILABLE',
      vatNumber,
      name: null,
      address: null,
      consultationNumber: null,
      message: `HMRC could not be asked: ${detail.slice(0, 200)}`,
    }
  }
}
