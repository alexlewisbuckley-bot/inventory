import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkVatFormat } from '@/lib/vat'

/**
 * Imported fresh per test.
 *
 * The access token is cached at module scope — correctly, since HMRC issues
 * them for four hours — which makes a shared import order-dependent: the
 * second test in a file would find the token already there and make one call
 * where the first made two.
 */
async function service() {
  vi.resetModules()
  return import('@/server/services/vat-check-service')
}

const lookupCall = (mock: { mock: { calls: unknown[][] } }) =>
  mock.mock.calls.find((call) => String(call[0]).includes('/check-vat-number/lookup/'))!
const tokenCall = (mock: { mock: { calls: unknown[][] } }) =>
  mock.mock.calls.find((call) => String(call[0]).endsWith('/oauth/token'))!

/**
 * Asking HMRC about a VAT number.
 *
 * The request is stubbed rather than sent — these assert the shape of what we
 * ask and how we read the answer, both taken from HMRC's published OpenAPI
 * spec. The live call has never been made from here; the network this was
 * built on cannot reach HMRC.
 */

/** Two of the VRNs HMRC ships as sandbox test data. */
const SANDBOX_VRNS = ['553557881', '436189915']

const ok = (body: unknown) => ({
  ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body),
}) as unknown as Response

const REGISTRATION = {
  target: {
    name: 'Credite Sberger Donal Inc.',
    vatNumber: '553557881',
    address: { line1: '131B Barton Hamlet', postcode: 'SW97 5CK', countryCode: 'GB' },
  },
  processingDate: '2019-01-31T12:43:17+00:00',
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  process.env.HMRC_CLIENT_ID = 'test-client'
  process.env.HMRC_CLIENT_SECRET = 'test-secret'
  process.env.HMRC_VAT_API_BASE = 'https://test-api.service.hmrc.gov.uk'
  delete process.env.HMRC_VAT_API_SCOPE

  fetchMock = vi.fn(async (url: string | URL) => {
    const href = String(url)
    if (href.endsWith('/oauth/token')) {
      return ok({ access_token: 'token-abc', expires_in: 14_400 })
    }
    return ok(REGISTRATION)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.HMRC_CLIENT_ID
  delete process.env.HMRC_CLIENT_SECRET
  delete process.env.HMRC_VAT_API_BASE
})

describe('HMRC’s own sandbox numbers', () => {
  it('do not satisfy the real check digits', () => {
    // Recorded because it is surprising and load-bearing: the test data is
    // synthetic, so anything that gates on the checksum makes the sandbox
    // impossible to test against.
    for (const vrn of SANDBOX_VRNS) {
      expect(checkVatFormat(vrn).status, vrn).toBe('BAD_CHECKSUM')
    }
  })

  it('are still sent to HMRC rather than rejected first', async () => {
    const { checkVatNumber } = await service()
    const result = await checkVatNumber(SANDBOX_VRNS[0]!)

    expect(String(lookupCall(fetchMock)[0])).toContain(
      `/organisations/vat/check-vat-number/lookup/${SANDBOX_VRNS[0]}`,
    )
    expect(result.status).toBe('REGISTERED')
  })
})

describe('the request', () => {
  it('asks for the read:vat scope, which is what the spec names', async () => {
    const { checkVatNumber } = await service()
    await checkVatNumber('553557881')
    const body = String((tokenCall(fetchMock)[1] as RequestInit).body)
    expect(body).toContain('grant_type=client_credentials')
    expect(body).toContain('scope=read%3Avat')
  })

  it('sends the version 2.0 Accept header and the bearer token', async () => {
    const { checkVatNumber } = await service()
    await checkVatNumber('553557881')
    const headers = (lookupCall(fetchMock)[1] as RequestInit).headers as Record<string, string>
    expect(headers.Accept).toBe('application/vnd.hmrc.2.0+json')
    expect(headers.Authorization).toBe('Bearer token-abc')
  })

  it('asks for a consultation number when told who is asking', async () => {
    const { checkVatNumber } = await service()
    await checkVatNumber('553557881', 'GB 146295999727')
    expect(String(lookupCall(fetchMock)[0])).toContain('/lookup/553557881/146295999727')
  })

  it('fetches one token and reuses it, rather than one per lookup', async () => {
    const { checkVatNumber } = await service()
    await checkVatNumber('553557881')
    await checkVatNumber('436189915')

    const tokens = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/oauth/token'))
    expect(tokens).toHaveLength(1)
  })
})

describe('the answer', () => {
  it('reads the registered name and address', async () => {
    const { checkVatNumber } = await service()
    const result = await checkVatNumber('553557881')
    expect(result.name).toBe('Credite Sberger Donal Inc.')
    expect(result.address).toBe('131B Barton Hamlet, SW97 5CK')
  })

  it('reports a number HMRC does not hold', async () => {
    fetchMock.mockImplementation(async (url: string | URL) => (
      String(url).endsWith('/oauth/token')
        ? ok({ access_token: 't', expires_in: 100 })
        : ({ ok: false, status: 404, text: async () => 'not found' } as unknown as Response)
    ))
    const { checkVatNumber } = await service()
    const result = await checkVatNumber('553557881')
    expect(result.status).toBe('NOT_FOUND')
    expect(result.message).toMatch(/no registration/i)
  })

  it('never throws when HMRC is broken — an intake must not fail on it', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('connect ECONNREFUSED')
    })
    const { checkVatNumber } = await service()
    const result = await checkVatNumber('553557881')
    expect(result.status).toBe('UNAVAILABLE')
    expect(result.message).toMatch(/ECONNREFUSED/)
  })
})

describe('without credentials', () => {
  beforeEach(() => {
    delete process.env.HMRC_CLIENT_ID
    delete process.env.HMRC_CLIENT_SECRET
  })

  it('falls back to the check digits and says nothing when they pass', async () => {
    const { checkVatNumber } = await service()
    const result = await checkVatNumber('454273686')
    expect(result.status).toBe('UNCHECKED')
    expect(result.message).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a misread number, which is the check it can still make', async () => {
    const { checkVatNumber } = await service()
    const result = await checkVatNumber('454273687')
    expect(result.status).toBe('MALFORMED')
    expect(result.message).toMatch(/check digits/i)
  })
})
