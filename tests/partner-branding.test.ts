import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  coloursFrom, isBrandish, logoCandidates, normaliseHex, proposeBrand,
} from '@/server/services/brand-fetch'

const read = (path: string) => readFileSync(path, 'utf8')
const fetcher = read('src/server/services/brand-fetch.ts')
const service = read('src/server/services/partner-service.ts')
const action = read('src/app/actions/partners.ts')
const panel = read('src/components/reference/PartnerBrand.tsx')
const gate = read('src/components/portal/PortalGate.tsx')
const room = read('src/components/portal/PortalRoom.tsx')
const choice = read('src/components/portal/RecipientChoice.tsx')
const portalLogo = read('src/app/p/[token]/logo/route.ts')
const recipientLogo = read('src/app/r/[token]/logo/route.ts')
const staffLogo = read('src/app/api/partner-logo/[id]/route.ts')
const migration = read('src/server/db/migrations/0063_partner_branding.sql')

/**
 * Making a partner's portal look like the partner.
 *
 * Alex: "add a way to brand the sites with logo colours etc from partner
 * companies, posting their URL and having claude skin it would be ideal."
 *
 * The colours existed and were never editable — the form carried them as
 * hidden fields at our own navy and teal, so every partner portal looked like
 * our software rather than theirs.
 */

describe('reading a company’s own site', () => {
  it('will not fetch an address only this server can reach', () => {
    /*
     * The URL comes from a form, and a server that fetches whatever it is
     * given is a way to reach things only the server can see: a cloud
     * metadata endpoint, a database admin page, anything on the private side
     * of the network.
     */
    expect(fetcher).toContain('function privateAddress')
    expect(fetcher).toContain("a === 10")
    expect(fetcher).toContain("a === 127")
    expect(fetcher).toContain("(a === 172 && b >= 16 && b <= 31)")
    expect(fetcher).toContain("(a === 192 && b === 168)")
    // 169.254.169.254 is the metadata address on every major cloud.
    expect(fetcher).toContain("(a === 169 && b === 254)")
    expect(fetcher).toContain("lower === '::1'")
  })

  it('checks the resolved address, not the name somebody typed', () => {
    /*
     * A hostname somebody owns can be pointed at 127.0.0.1, and usually is
     * when somebody is trying this on. Every address it resolves to is
     * checked, because a name answering with one public and one private
     * address is the whole trick.
     */
    expect(fetcher).toContain("await lookup(host, { all: true })")
    expect(fetcher).toContain('for (const { address } of addresses)')
    expect(fetcher).toContain("address.replace(/^::ffff:/i, '')")
  })

  it('re-checks every hop of a redirect, not only the first', () => {
    // Otherwise a public URL that redirects to localhost walks straight past
    // the check that was supposed to stop it.
    expect(fetcher).toContain("redirect: 'manual'")
    expect(fetcher).toContain('await assertPublic(url)')
    expect(fetcher).toContain('MAX_REDIRECTS')
  })

  it('refuses anything that is not http', () => {
    // file:// and the rest are not web addresses, and one of them reads the
    // disk of the machine this runs on.
    expect(fetcher).toContain("url.protocol !== 'http:' && url.protocol !== 'https:'")
  })

  it('gives up rather than hanging, and stops reading rather than filling memory', () => {
    expect(fetcher).toContain('AbortSignal.timeout(TIMEOUT_MS)')
    expect(fetcher).toContain('function readCapped')
    expect(fetcher).toContain('if (total > limit)')
  })

  it('tells the far end nothing about who is asking', () => {
    /*
     * The person's name, their company and this deployment are none of the
     * destination's business — and a partner's own marketing team reading
     * their logs should not learn which dealer is setting them up.
     */
    expect(fetcher).toContain("'User-Agent': 'Mozilla/5.0 (compatible; brand-preview/1.0)'")
    expect(fetcher).not.toMatch(/onestreet|bluecroft|inventory-c7qt/i)
  })
})

describe('what it takes from a page', () => {
  it('reads a hex colour the way people write them', () => {
    expect(normaliseHex('#04173A')).toBe('#04173a')
    expect(normaliseHex('04173a')).toBe('#04173a')
    expect(normaliseHex('#abc')).toBe('#aabbcc')
    expect(normaliseHex('rgb(1,2,3)')).toBeNull()
    expect(normaliseHex('')).toBeNull()
    expect(normaliseHex(null)).toBeNull()
  })

  it('ignores the greys every site has', () => {
    /*
     * Black, white and the greys between are page furniture. Picking one
     * would turn a portal the colour of its own body text, and every site in
     * the world would propose the same thing.
     */
    expect(isBrandish('#ffffff')).toBe(false)
    expect(isBrandish('#000000')).toBe(false)
    expect(isBrandish('#333333')).toBe(false)
    expect(isBrandish('#f8f8f6')).toBe(false)
    expect(isBrandish('#04173a')).toBe(true)
    expect(isBrandish('#0f766e')).toBe(true)
  })

  it('prefers what a company declared about itself', () => {
    // theme-color is set on purpose; a count of hex codes is a guess.
    expect(fetcher).toContain("name === 'theme-color'")
    expect(fetcher).toContain('[...declared, ...byUse]')
  })

  it('prefers a mark somebody drew over a favicon', () => {
    /*
     * An apple-touch-icon is a square mark drawn on purpose; og:image is
     * usually a banner; a favicon is sixteen pixels of nothing, and .ico is
     * not a format an <img> renders reliably.
     */
    const order = fetcher.slice(fetcher.indexOf('function logoCandidates'))
    expect(order.indexOf('apple-touch-icon')).toBeLessThan(order.indexOf("'og:image'"))
    expect(order).toContain('!/\\.ico(\\?|$)/i')
  })

  it('does not fail a whole proposal because a site is unhelpful', () => {
    /*
     * A proposal with nothing in it is a true answer, and the screen says so.
     * It throws only for a URL that should not be fetched at all, which is a
     * different thing and worth saying out loud.
     */
    expect(fetcher).toContain("notes.push('Their site could not be reached.')")
    expect(fetcher).toContain('No usable logo was found')
  })
})

/*
 * A real estate agency's page, of the shape these actually are: a theme
 * colour, an apple-touch-icon somebody had drawn, a stylesheet whose brand
 * colour is repeated on every button, and the greys that every site has.
 */
const SITE = `<!doctype html><html><head>
<meta name="theme-color" content="#B8860B">
<link rel="apple-touch-icon" href="/mark.png">
<link rel="stylesheet" href="/site.css">
<meta property="og:image" content="https://meridian.example/banner.jpg">
<link rel="icon" href="/favicon.ico">
<title>Meridian Estates</title>
</head><body>
<img src="/img/meridian-logo.svg" alt="Meridian Estates logo">
<a class="btn" style="background:#B8860B">Enquire</a>
</body></html>`

const SITE_CSS = `.btn { background: #B8860B; border-color: #B8860B; }
.nav { color: #2F4F6F; }
.footer { color: #ffffff; background: #111111; }`

describe('against a page of the shape these actually are', () => {
  it('finds the colour the company declared, first', () => {
    const colours = coloursFrom(SITE, SITE_CSS)
    expect(colours[0]).toBe('#b8860b')
  })

  it('offers a second, different colour for the accent', () => {
    // An accent that matches the main colour exactly reads as a mistake.
    const colours = coloursFrom(SITE, SITE_CSS)
    expect(colours).toContain('#2f4f6f')
    expect(colours.find((hex) => hex !== colours[0])).toBe('#2f4f6f')
  })

  it('throws away the white and the near-black', () => {
    const colours = coloursFrom(SITE, SITE_CSS)
    expect(colours).not.toContain('#ffffff')
    expect(colours).not.toContain('#111111')
  })

  it('takes the drawn mark before the banner, and never the .ico', () => {
    const found = logoCandidates(SITE, new URL('https://meridian.example/'))
    expect(found[0]).toBe('https://meridian.example/mark.png')
    expect(found).toContain('https://meridian.example/banner.jpg')
    expect(found).toContain('https://meridian.example/img/meridian-logo.svg')
    expect(found.some((url) => url.endsWith('.ico'))).toBe(false)
  })

  it('makes every candidate absolute, whatever the page wrote', () => {
    // A relative href is useless to a fetch, and a page half of whose links
    // are relative is the normal case.
    const found = logoCandidates(SITE, new URL('https://meridian.example/about/'))
    for (const url of found) expect(url).toMatch(/^https:\/\//)
  })

  it('says nothing rather than guessing at a page with no branding in it', () => {
    expect(coloursFrom('<html><body>Hello</body></html>', '')).toEqual([])
    expect(logoCandidates('<html><body>Hello</body></html>', new URL('https://x.example/'))).toEqual([])
  })
})

describe('the guard, actually exercised', () => {
  it('refuses a loopback address outright', async () => {
    await expect(proposeBrand('http://127.0.0.1:3000/')).rejects.toThrow(/cannot be reached/)
  })

  it('refuses the cloud metadata address outright', async () => {
    // The one a server-side fetch is usually aimed at.
    await expect(proposeBrand('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/cannot be reached/)
  })

  it('refuses a private range', async () => {
    await expect(proposeBrand('http://10.0.0.5/')).rejects.toThrow(/cannot be reached/)
    await expect(proposeBrand('http://192.168.1.1/')).rejects.toThrow(/cannot be reached/)
    await expect(proposeBrand('http://172.16.0.1/')).rejects.toThrow(/cannot be reached/)
  })

  it('refuses a scheme that is not the web', async () => {
    await expect(proposeBrand('file:///etc/passwd')).rejects.toThrow(/web address/)
  })

  it('asks for something before it asks the network', async () => {
    await expect(proposeBrand('   ')).rejects.toThrow(/web address first/)
  })
})

describe('nothing applies itself', () => {
  it('proposes, and waits for a person', () => {
    /*
     * The failure to avoid is an estate agency's staff opening their portal
     * to find it quietly the wrong colour, and "a parser liked a stylesheet"
     * is not a reason anybody would accept for that.
     */
    expect(action).toContain('export async function proposeBrandAction')
    const propose = action.slice(action.indexOf('export async function proposeBrandAction'))
    const next = propose.indexOf('export async function', 1)
    expect(propose.slice(0, next)).not.toMatch(/setPartnerBrand|setPartnerLogo/)
    expect(panel).toContain('Nothing changes until you say so')
  })

  it('stores the logo somebody approved, not a second fetch of it', () => {
    // Refetching would mean the thing approved and the thing stored are two
    // different requests, and the second could answer differently.
    expect(action).toContain("formData.get('logoDataUrl')")
    expect(action).toContain('Buffer.from(match[2], \'base64\')')
    expect(action).toContain('assertLogoAcceptable(match[1], data.byteLength)')
  })

  it('shows the colours at the size they will be used', () => {
    // Two hex codes side by side tell nobody whether white text is readable
    // on the result.
    expect(panel).toContain("style={{ backgroundColor: brandColor }}")
    expect(panel).toContain('{partner.name}')
  })

  it('lets somebody nudge a colour without reading a site at all', () => {
    /*
     * The pickers used to appear only after a successful read, which left no
     * way to adjust a colour by hand — and the first thing anybody does with
     * a guessed palette is adjust it.
     */
    expect(panel).toContain("{proposal ? 'What their site says' : 'Their colours'}")
    expect(panel).toContain("proposed ? 'Use this' : 'Save colours'")
  })

  it('keeps a way in when a site gives nothing useful', () => {
    // Common for a company whose web presence is one page a cousin built.
    expect(panel).toContain('Or upload their logo')
    expect(action).toContain('export async function uploadPartnerLogoAction')
  })

  it('records where the branding came from', () => {
    /*
     * So a screen can say "taken from theircompany.com in March" rather than
     * presenting colours as if somebody here chose them — and a partner who
     * redesigns is something to notice rather than a portal that quietly
     * looks a year out of date.
     */
    expect(migration).toContain('brand_source_url text')
    expect(migration).toContain('brand_taken_at timestamptz')
    expect(service).toContain('brandSourceUrl: brand.sourceUrl ?? null')
    expect(panel).toContain('Taken from')
  })
})

describe('where the branding shows', () => {
  it('is on the door, the stock list and the recipient page', () => {
    /*
     * All three are pages somebody else's staff open after being told by
     * their own office to expect them. A page carrying a watch dealer's
     * branding instead reads as a mailshot.
     */
    expect(gate).toContain('src={`/p/${token}/logo`}')
    expect(room).toContain('src={`/p/${token}/logo`}')
    expect(choice).toContain('src={`/r/${token}/logo`}')
  })

  it('falls back to their name rather than to an empty space', () => {
    expect(gate).toContain('hasLogo ? (')
    expect(room).toContain('partner.hasLogo ? (')
    expect(choice).toContain('campaign.hasLogo ? (')
  })

  it('carries bytes rather than a link to their server', () => {
    // A hotlinked logo is a broken image on our page the day they redesign —
    // on a page their own staff are looking at.
    expect(migration).toContain('logo_data bytea')
    expect(service).toContain('logoData: logo?.data ?? null')
  })

  it('does not carry the bytes into a list that only draws a tick', () => {
    expect(service).toContain('hasLogo: sql<boolean>`${partners.logoData} is not null`')
    // The listing selects whether, never the bytes.
    const listing = service.slice(service.indexOf('export async function listPartners'))
    expect(listing.slice(0, 1400)).not.toContain('logoData: partners.logoData')
  })

  it('serves each logo by the key the page that needs it actually holds', () => {
    /*
     * The portal has a portal token, a recipient has their own, and our
     * screens have a session. A route taking an id would let anybody holding
     * one read any partner's mark.
     */
    expect(portalLogo).toContain('getPartnerLogoByPortalToken(params.token)')
    expect(recipientLogo).toContain('getRecipientLogo(params.token)')
    expect(staffLogo).toContain('getSessionUser()')
    expect(staffLogo).toContain("can(user.role, 'partner:read')")
  })

  it('puts no passphrase on the mark the gate itself draws', () => {
    /*
     * It is the logo the company puts on its own website, and a gate on it
     * would only mean the sign-in page could not show whose door it is —
     * which is the one thing telling somebody they are at the right address.
     */
    expect(portalLogo).not.toContain('hasPortalPass')
    expect(portalLogo).toContain("'X-Robots-Tag': 'noindex, nofollow'")
  })
})
