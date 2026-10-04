import { describe, expect, it } from 'vitest'
import {
  checkDomain, hostOf, isOurHost, looksLikeApex, ownHosts, passesThrough,
} from '@/lib/domains'

/**
 * Whose site is this?
 *
 * Every one of these decisions is made in the edge runtime on the way to a
 * page somebody else's customers are looking at, where there is no database to
 * check against and no second chance. Getting `isOurHost` wrong in one
 * direction serves the application as a shop; getting it wrong in the other
 * leaves a reseller's domain showing our login page.
 */
describe('reading the host', () => {
  it('drops the port and the case, which both arrive uninvited', () => {
    expect(hostOf('Shop.TheirSite.com:3000')).toBe('shop.theirsite.com')
    expect(hostOf('  EXAMPLE.COM  ')).toBe('example.com')
  })

  it('leaves an IPv6 literal in one piece', () => {
    // Splitting this on ':' would return '[' and route nobody anywhere.
    expect(hostOf('[::1]:3000')).toBe('[::1]')
  })

  it('is empty for a request with no host at all', () => {
    expect(hostOf(null)).toBe('')
    expect(hostOf(undefined)).toBe('')
  })
})

describe('telling our hosts from a reseller’s', () => {
  it('knows localhost and the platform’s own names', () => {
    expect(isOurHost('localhost')).toBe(true)
    expect(isOurHost('inventory-c7qt.vercel.app')).toBe(true)
    // Every preview build gets one of these. A preview read as an unknown
    // domain would rewrite its whole surface into a shop that does not exist.
    expect(isOurHost('inventory-git-branch-team.vercel.app')).toBe(true)
  })

  it('treats a configured production hostname as ours', () => {
    expect(isOurHost('app.onestreet.example', ownHosts('app.onestreet.example'))).toBe(true)
    expect(isOurHost('shop.theirsite.com', ownHosts('app.onestreet.example'))).toBe(false)
  })

  it('treats a missing host as ours, never as somebody’s shop', () => {
    // A request with no Host is malformed, and the safe reading of a malformed
    // request is "not a shop" — the application 404s, rather than a stranger's
    // hostname being looked up.
    expect(isOurHost('')).toBe(true)
  })

  it('parses a configured list with spaces, ports and schemes in it', () => {
    expect(ownHosts(' https://a.example , b.example:443 ')).toEqual(['a.example', 'b.example'])
    expect(ownHosts(undefined)).toEqual([])
  })
})

describe('paths that are never a shop', () => {
  it('lets the shop’s own assets through unrewritten', () => {
    // A page on a custom domain still asks for /s/<key>/logo. Rewriting that
    // again would bury the key and leave every shop without its mark.
    expect(passesThrough('/s/abc/logo')).toBe(true)
    expect(passesThrough('/api/notifications/live')).toBe(true)
    expect(passesThrough('/_next/static/chunk.js')).toBe(true)
    expect(passesThrough('/embed.js')).toBe(true)
  })

  it('rewrites everything a customer would actually visit', () => {
    expect(passesThrough('/')).toBe(false)
    expect(passesThrough('/anything')).toBe(false)
  })
})

/**
 * What we will accept as a domain.
 *
 * Narrower than DNS allows, on purpose: a hostname stored with a typo in it is
 * a shop that silently never appears, and the person who typed it has no way
 * to tell that from DNS that has not propagated yet.
 */
describe('accepting a domain', () => {
  it('takes the hostname out of whatever was pasted', () => {
    expect(checkDomain('https://shop.theirsite.com/watches?x=1').value).toBe('shop.theirsite.com')
    expect(checkDomain('SHOP.TheirSite.com.').value).toBe('shop.theirsite.com')
    expect(checkDomain('shop.theirsite.com:443').value).toBe('shop.theirsite.com')
  })

  it('treats empty as "no domain" rather than as a mistake', () => {
    const result = checkDomain('   ')
    expect(result.ok).toBe(true)
    expect(result.value).toBeUndefined()
  })

  it('refuses things that are not hostnames', () => {
    for (const bad of ['not a domain', 'localhost', 'shop', 'shop.', '.com', 'shop..com', 'http://']) {
      expect(checkDomain(bad).ok, bad).toBe(false)
    }
  })

  it('refuses this application’s own address', () => {
    // Otherwise a shop quietly takes over the application for everybody.
    expect(checkDomain('inventory-c7qt.vercel.app').ok).toBe(false)
    expect(checkDomain('app.onestreet.example', ['app.onestreet.example']).ok).toBe(false)
  })

  it('warns about an apex domain without refusing it', () => {
    // Plenty of registrars support flattening under another name, so refusing
    // would be telling somebody their own DNS does not work.
    expect(looksLikeApex('theirsite.com')).toBe(true)
    expect(looksLikeApex('shop.theirsite.com')).toBe(false)
    expect(checkDomain('theirsite.com').ok).toBe(true)
  })
})
