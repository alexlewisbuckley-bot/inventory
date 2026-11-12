import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { ValidationError } from '@/lib/errors'
import { logger } from '@/lib/logger'

/**
 * Reading a company's branding off their own website.
 *
 * The parsing and the fetching are separate on purpose. `coloursFrom` and
 * `logoCandidates` are pure — give them markup and they answer — so the part
 * that decides what a company looks like can be tested against real pages
 * without a network, while the part that reaches out to the internet is kept
 * small enough to read in one go.
 *
 * Alex: "posting their URL and having claude skin it would be ideal."
 *
 * Most of what makes a page look like a company is published in its markup
 * already: an apple-touch-icon somebody had drawn properly, a theme-colour
 * meta tag, an og:image. Taking those is faster, free, and more faithful than
 * asking a model to guess a palette from a screenshot — and it works without
 * an API key, which matters because this is the first thing somebody will try
 * on a Sunday.
 *
 * Nothing here applies itself. It returns a proposal, the screen shows it, and
 * a person says yes. The failure to avoid is a partner's portal silently
 * turning the wrong colour because a parser liked a stylesheet.
 */

/** How long to wait on somebody else's server before giving up. */
const TIMEOUT_MS = 6_000
/** Enough HTML to carry a <head>; a marketing page can be megabytes of body. */
const MAX_HTML_BYTES = 512 * 1024
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3

export interface BrandProposal {
  sourceUrl: string
  brandColor: string | null
  accentColor: string | null
  logo: { data: Buffer; mimeType: string; url: string } | null
  /** What was looked at, for a screen that has to explain a bad guess. */
  notes: string[]
}

/**
 * Hosts this server may not be asked to fetch.
 *
 * The URL comes from a form, and a server that fetches whatever it is given
 * is a way to reach things only the server can see — a metadata endpoint, a
 * database admin page, anything on the private side of the network. Checked
 * against the resolved ADDRESS rather than the hostname, because a name
 * somebody owns can be pointed at 127.0.0.1 and usually is when somebody is
 * trying this on.
 */
function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase()
    return lower === '::1'
      || lower.startsWith('fc') || lower.startsWith('fd')   // unique local
      || lower.startsWith('fe80')                            // link local
      || lower.startsWith('::ffff:')                         // v4-mapped: checked below
  }
  const [a, b] = ip.split('.').map(Number)
  return a === 10
    || a === 127
    || a === 0
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)   // link local, and the cloud metadata address
    || a >= 224                    // multicast and reserved
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('That has to be a web address.')
  }
  const host = url.hostname
  if (isIP(host)) {
    if (privateAddress(host)) throw new ValidationError('That address cannot be reached from here.')
    return
  }
  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    throw new ValidationError('That address could not be found.')
  }
  // Every address, not the first: a name that resolves to one public and one
  // private address is the whole trick.
  for (const { address } of addresses) {
    const bare = address.replace(/^::ffff:/i, '')
    if (privateAddress(bare)) throw new ValidationError('That address cannot be reached from here.')
  }
}

/** Fetch, with the redirect chain checked at every hop rather than only the first. */
async function safeFetch(target: URL, accept: string): Promise<Response> {
  let url = target
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublic(url)
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // A plain, generic client. The person's name, their company and this
        // deployment are none of the destination's business.
        'User-Agent': 'Mozilla/5.0 (compatible; brand-preview/1.0)',
        Accept: accept,
      },
    })
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location')
      if (!next) return response
      url = new URL(next, url)
      continue
    }
    return response
  }
  throw new ValidationError('That address redirected too many times.')
}

/** Read at most `limit` bytes, so a huge file cannot fill memory. */
async function readCapped(response: Response, limit: number): Promise<Buffer> {
  const reader = response.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      break
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

const attr = (tag: string, name: string): string | null => {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'))
  return match ? match[1] : null
}

/** A hex colour, normalised to six digits and lower case. */
export function normaliseHex(raw: string | null | undefined): string | null {
  if (!raw) return null
  const text = raw.trim().toLowerCase()
  const match = text.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (!match) return null
  const digits = match[1]
  const full = digits.length === 3
    ? digits.split('').map((d) => d + d).join('')
    : digits
  return `#${full}`
}

/**
 * Whether a colour is one somebody would call a brand colour.
 *
 * Black, white and the greys between them are page furniture: every site has
 * them, and picking one would turn a portal the colour of its own body text.
 * A brand colour has some saturation and is not so pale that white text
 * vanishes on it.
 */
export function isBrandish(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max - min < 24) return false          // grey
  if (max > 240 && min > 200) return false  // nearly white
  if (max < 24) return false                // nearly black
  return true
}

/**
 * The colours a page declares about itself, most-used first.
 *
 * `theme-color` is the one a company sets deliberately, so it wins. After
 * that it is a count of the hex colours written in the page's own markup and
 * its first stylesheet — crude, and right more often than not, because a
 * brand colour is the one repeated on every button.
 */
export function coloursFrom(html: string, css: string): string[] {
  const declared: string[] = []
  for (const tag of html.match(/<meta[^>]*>/gi) ?? []) {
    const name = (attr(tag, 'name') ?? '').toLowerCase()
    if (name === 'theme-color' || name === 'msapplication-tilecolor') {
      const hex = normaliseHex(attr(tag, 'content'))
      if (hex && isBrandish(hex)) declared.push(hex)
    }
  }

  const counts = new Map<string, number>()
  for (const source of [html, css]) {
    for (const found of source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
      const hex = normaliseHex(found.slice(0, 7))
      if (!hex || !isBrandish(hex)) continue
      counts.set(hex, (counts.get(hex) ?? 0) + 1)
    }
  }
  const byUse = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex)
  return [...new Set([...declared, ...byUse])]
}

/**
 * The best candidate for a logo, in the order a designer would expect.
 *
 * An apple-touch-icon is a square mark somebody drew on purpose. og:image is
 * usually a banner — second best, and often the only thing there. A favicon is
 * last because it is 16 pixels of nothing, and .ico is not a format browsers
 * will render in an <img> reliably.
 */
export function logoCandidates(html: string, base: URL): string[] {
  const out: string[] = []
  const push = (href: string | null) => {
    if (!href) return
    try { out.push(new URL(href, base).toString()) } catch { /* a malformed href is not an error */ }
  }

  for (const tag of html.match(/<link[^>]*>/gi) ?? []) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase()
    if (rel.includes('apple-touch-icon')) push(attr(tag, 'href'))
  }
  for (const tag of html.match(/<meta[^>]*>/gi) ?? []) {
    const prop = (attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase()
    if (prop === 'og:image' || prop === 'twitter:image') push(attr(tag, 'content'))
  }
  // A real <img> that calls itself a logo: often the sharpest thing on the page.
  for (const tag of html.match(/<img[^>]*>/gi) ?? []) {
    const src = attr(tag, 'src') ?? ''
    const alt = attr(tag, 'alt') ?? ''
    if (/logo/i.test(src) || /logo/i.test(alt)) push(src)
  }
  for (const tag of html.match(/<link[^>]*>/gi) ?? []) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase()
    if (rel.includes('icon') && !rel.includes('apple') && !/\.ico(\?|$)/i.test(attr(tag, 'href') ?? '')) {
      push(attr(tag, 'href'))
    }
  }
  return [...new Set(out)]
}

const USABLE_IMAGE = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']

/**
 * Look at a company's site and propose how their portal should look.
 *
 * Never throws for a site that is simply unhelpful: a proposal with nothing in
 * it is a true answer, and the screen says so. It throws only for a URL that
 * should not be fetched at all, which is a different thing and worth saying.
 */
export async function proposeBrand(rawUrl: string): Promise<BrandProposal> {
  const trimmed = rawUrl.trim()
  if (!trimmed) throw new ValidationError('Give their web address first.')

  /*
   * A scheme somebody wrote is honoured — and then refused if it is not the
   * web. Prefixing https:// to anything unrecognised meant "file:///etc/passwd"
   * became "https://file:///etc/passwd", which failed as a DNS lookup of a
   * host called "file". Safe by luck rather than by decision, and it answered
   * "that address could not be found" to something that was never going to be
   * fetched in the first place.
   */
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) {
    throw new ValidationError('That has to be a web address.')
  }
  // People type "acme.com", not "https://acme.com".
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new ValidationError('That does not look like a web address.')
  }

  const notes: string[] = []
  let html = ''
  try {
    const response = await safeFetch(url, 'text/html,application/xhtml+xml')
    if (!response.ok) {
      notes.push(`Their site answered ${response.status}.`)
    } else {
      html = (await readCapped(response, MAX_HTML_BYTES)).toString('utf8')
    }
  } catch (error) {
    if (error instanceof ValidationError) throw error
    logger.info('brand fetch failed', { host: url.hostname })
    notes.push('Their site could not be reached.')
  }

  if (!html) {
    return { sourceUrl: url.toString(), brandColor: null, accentColor: null, logo: null, notes }
  }

  // The first stylesheet only. A site has a dozen, and the brand colours are
  // in the first — the rest are a component library and a cookie banner.
  let css = ''
  const sheet = (html.match(/<link[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/i) ?? [])[0]
  const sheetHref = sheet ? attr(sheet, 'href') : null
  if (sheetHref) {
    try {
      const response = await safeFetch(new URL(sheetHref, url), 'text/css')
      if (response.ok) css = (await readCapped(response, MAX_HTML_BYTES)).toString('utf8')
    } catch {
      notes.push('Their stylesheet could not be read, so the colours come from the page alone.')
    }
  }

  const colours = coloursFrom(html, css)
  if (colours.length === 0) notes.push('No brand colour was declared on their site.')

  let logo: BrandProposal['logo'] = null
  for (const candidate of logoCandidates(html, url).slice(0, 4)) {
    try {
      const response = await safeFetch(new URL(candidate), 'image/*')
      if (!response.ok) continue
      const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      if (!USABLE_IMAGE.includes(type)) continue
      const data = await readCapped(response, MAX_IMAGE_BYTES)
      if (data.byteLength === 0) continue
      logo = { data, mimeType: type, url: candidate }
      break
    } catch {
      // A logo that will not load is not a reason to fail the whole proposal.
    }
  }
  if (!logo) notes.push('No usable logo was found, so the portal shows their name instead.')

  return {
    sourceUrl: url.toString(),
    brandColor: colours[0] ?? null,
    // A second, different colour where the site offers one: the accent is used
    // for small marks and reads as a mistake when it matches the first exactly.
    accentColor: colours.find((hex) => hex !== colours[0]) ?? null,
    logo,
    notes,
  }
}
