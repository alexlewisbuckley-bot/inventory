import { describe, expect, it } from 'vitest'
import { newPublicToken } from '@/server/services/reseller-service'
import { navLinkSchema, parseNavLinks, resellerSchema, fieldErrors } from '@/lib/validation'

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

/**
 * Navigation links.
 *
 * These become anchors on a page somebody else's customers visit, so the
 * scheme is checked where the link is written rather than escaped wherever it
 * is rendered. A "javascript:" URL pasted out of somewhere is a script those
 * customers would run.
 */
describe('reseller navigation links', () => {
  const link = (href: string) => navLinkSchema.safeParse({ label: 'Home', href })

  it('accepts an ordinary website link', () => {
    expect(link('https://example.com').success).toBe(true)
    expect(link('http://example.com/collection?a=1').success).toBe(true)
  })

  it('refuses anything that is not http or https', () => {
    for (const href of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox',
      'file:///etc/passwd',
      '/relative/path',
      'example.com',
    ]) {
      expect(link(href).success, href).toBe(false)
    }
  })

  it('requires a label, so a link is never an empty target', () => {
    expect(navLinkSchema.safeParse({ label: '', href: 'https://example.com' }).success).toBe(false)
  })

  describe('reading them back', () => {
    it('returns nothing for a reseller who set none', () => {
      expect(parseNavLinks(null)).toEqual([])
      expect(parseNavLinks('')).toEqual([])
    })

    it('survives whatever is in the column rather than taking the page down', () => {
      // The column is written by this application, but a page that 500s
      // because a row holds something unexpected is worse than one that
      // renders without its navigation.
      expect(parseNavLinks('not json')).toEqual([])
      expect(parseNavLinks('{"label":"Home"}')).toEqual([])
      expect(parseNavLinks('[{"label":"Home","href":"javascript:alert(1)"}]')).toEqual([])
    })

    it('reads back what was stored', () => {
      const stored = JSON.stringify([{ label: 'Home', href: 'https://example.com' }])
      expect(parseNavLinks(stored)).toEqual([{ label: 'Home', href: 'https://example.com' }])
    })
  })
})

/**
 * The reseller's own website.
 *
 * Their logo and the button in the header both point at it, so a value a
 * browser will not follow sends their customers somewhere wrong. Typed without
 * a scheme it is a relative path, which resolves against the page it is on —
 * that is, against our domain rather than theirs.
 */
describe('the reseller website', () => {
  const site = (website: string) => {
    const result = resellerSchema.safeParse({ name: 'Gulf Timepieces', website })
    return result.success ? result.data.website : `ERROR: ${fieldErrors(result.error).website}`
  }

  it('adds the scheme people do not type', () => {
    expect(site('trendsourcing.com')).toBe('https://trendsourcing.com')
    expect(site('www.trendsourcing.com')).toBe('https://www.trendsourcing.com')
    expect(site('  trendsourcing.com  ')).toBe('https://trendsourcing.com')
  })

  it('leaves a full address alone', () => {
    expect(site('https://trendsourcing.com')).toBe('https://trendsourcing.com')
    expect(site('http://trendsourcing.com/collection')).toBe('http://trendsourcing.com/collection')
  })

  it('treats blank as no website rather than as an empty link', () => {
    expect(site('')).toBeNull()
  })

  it('refuses something that is not a web address', () => {
    for (const bad of [
      'javascript:alert(1)',
      'not a website',
      'mailto:someone@example.com',
      'data:text/html,<script>alert(1)</script>',
      'localhost',
    ]) {
      expect(String(site(bad)), bad).toMatch(/^ERROR/)
    }
  })
})
