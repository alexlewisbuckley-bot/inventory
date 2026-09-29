import { describe, expect, it } from 'vitest'
import { newPublicToken } from '@/server/services/reseller-service'
import { resellerSchema, fieldErrors } from '@/lib/validation'

/**
 * The shop-window token.
 *
 * This is the entire access control on a page listing live stock and its
 * prices. It is not a slug, an id or anything derived from the reseller's
 * name — a URL somebody can guess from the company is an invitation, not a
 * lock.
 */
describe('the shop-window token', () => {
  it('is long enough that guessing is not a strategy', () => {
    // 24 random bytes, base64url: 32 characters of a 64-symbol alphabet.
    const token = newPublicToken()
    expect(token.length).toBeGreaterThanOrEqual(32)
  })

  it('is URL-safe, so it survives being pasted into an email', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(newPublicToken()).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('never repeats', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 500; i += 1) seen.add(newPublicToken())
    expect(seen.size).toBe(500)
  })
})

describe('reseller branding', () => {
  const base = { name: 'Gulf Timepieces' }

  it('accepts a reseller with just a name', () => {
    const result = resellerSchema.safeParse(base)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.brandColor).toBe('#04173A')
      expect(result.data.isActive).toBe(true)
    }
  })

  /**
   * The colours are interpolated into a stylesheet on a public page, so
   * anything that is not a colour is somewhere to put something that is not a
   * colour. Rejected at the edge rather than escaped later.
   */
  it('refuses a brand colour that is not a colour', () => {
    for (const bad of ['red', 'rgb(0,0,0)', '#fff', 'javascript:alert(1)', '#04173A; }']) {
      const result = resellerSchema.safeParse({ ...base, brandColor: bad })
      expect(result.success, bad).toBe(false)
      if (!result.success) expect(fieldErrors(result.error).brandColor).toMatch(/hex/i)
    }
  })

  it('accepts a proper hex colour in either case', () => {
    for (const good of ['#04173A', '#0f766e', '#FFFFFF']) {
      expect(resellerSchema.safeParse({ ...base, brandColor: good }).success, good).toBe(true)
    }
  })

  it('rejects a currency the application cannot convert into', () => {
    expect(resellerSchema.safeParse({ ...base, displayCurrency: 'EUR' }).success).toBe(false)
    expect(resellerSchema.safeParse({ ...base, displayCurrency: 'AED' }).success).toBe(true)
  })

  it('normalises a blank contact email to null rather than an empty string', () => {
    const result = resellerSchema.safeParse({ ...base, contactEmail: '' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.contactEmail).toBeNull()
  })

  it('rejects a contact email that is not one', () => {
    expect(resellerSchema.safeParse({ ...base, contactEmail: 'not-an-email' }).success).toBe(false)
  })
})
