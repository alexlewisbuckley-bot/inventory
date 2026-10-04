/**
 * Whose domain is this request for.
 *
 * A reseller's customers should see the reseller's address bar, not ours. The
 * machinery for that is two decisions made on every request — is this host one
 * of ours, and if not, which shop does it belong to — and both are small
 * enough to be pure functions, which is the only reason they can be tested at
 * all: the first of them runs in the edge runtime, where there is no database
 * and no Node.
 */

/** Our own hosts, which must never be mistaken for a reseller's. */
const OURS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
]

/**
 * Hosts belonging to the platform rather than to anybody.
 *
 * Every preview build gets a `*.vercel.app` name, so treating the suffix as
 * ours is what stops a preview deployment being read as an unknown domain and
 * rewritten into a shop that does not exist.
 */
const PLATFORM_SUFFIXES = ['.vercel.app', '.localhost']

/**
 * The host, without the port and without the case.
 *
 * `Host` carries the port in development and an upper-cased name whenever
 * somebody types one, and a lookup that does not strip both finds nothing for
 * a domain that is plainly configured.
 */
export function hostOf(header: string | null | undefined): string {
  if (!header) return ''
  // A Host header never carries a scheme, but a configured hostname pasted out
  // of a browser does, and 'https://a.example' split on ':' is 'https'.
  const value = header.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  // An IPv6 literal is bracketed, and splitting on ':' would cut it to pieces.
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1)
  return value.split(':')[0] ?? ''
}

/**
 * Is this the application itself, or somebody's shop?
 *
 * `extra` is the deployment's own production hostnames, which cannot be known
 * at build time — a self-hosted install has its own, and a custom domain on
 * the *application* would otherwise look exactly like a reseller's.
 */
export function isOurHost(host: string, extra: readonly string[] = []): boolean {
  if (!host) return true
  if (OURS.includes(host)) return true
  if (PLATFORM_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true
  return extra.some((candidate) => candidate && hostOf(candidate) === host)
}

/** The application's own hostnames, as configured. */
export function ownHosts(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((value) => hostOf(value)).filter(Boolean)
}

/**
 * Paths that are never a shop, whichever host asked for them.
 *
 * The shop routes themselves are on the list: a page served on a custom domain
 * still fetches its logo from `/s/<key>/logo`, and rewriting that into
 * `/s/<key>/s/<key>/logo` would leave every reseller's shop without its mark.
 */
const PASS_THROUGH = ['/s/', '/api/', '/_next/', '/embed.js', '/favicon.ico', '/robots.txt']

export function passesThrough(pathname: string): boolean {
  return PASS_THROUGH.some((prefix) => pathname === prefix || pathname.startsWith(prefix))
}

/**
 * What a hostname has to look like before we will store it.
 *
 * Deliberately narrower than the DNS specification allows: a label of letters,
 * digits and hyphens, at least two of them, and no trailing dot. Anything
 * stranger is far likelier to be a typed mistake than a domain somebody owns,
 * and a mistake stored here is a shop that silently never appears.
 */
const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export interface DomainCheck {
  ok: boolean
  /** The form to store, when it is usable. */
  value?: string
  error?: string
}

/**
 * Clean up what somebody pasted, and say why it cannot be used.
 *
 * People paste a whole URL, with the scheme, a path and sometimes a trailing
 * slash, because that is what the browser gave them. Taking the hostname out
 * of it is friendlier than refusing and more honest than storing it as typed.
 */
export function checkDomain(raw: string, extra: readonly string[] = []): DomainCheck {
  let value = raw.trim().toLowerCase()
  if (!value) return { ok: true, value: undefined }

  // A pasted URL, reduced to its host.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  value = value.split('/')[0] ?? ''
  value = value.split('?')[0] ?? ''
  value = hostOf(value)
  // A trailing dot is a valid absolute name and a certain source of mismatches.
  value = value.replace(/\.$/, '')

  if (!DOMAIN.test(value)) {
    return { ok: false, error: 'That does not look like a domain. Use something like shop.theirsite.com.' }
  }
  if (isOurHost(value, extra)) {
    return { ok: false, error: 'That is this application’s own address, not a reseller’s.' }
  }
  return { ok: true, value }
}

/**
 * Advice, not validation.
 *
 * An apex domain cannot carry a CNAME, so a reseller who puts one here has a
 * support conversation ahead of them that a sentence now avoids. It is a
 * warning rather than a refusal because plenty of registrars do support it,
 * under a name of their own — ALIAS, ANAME, flattening — and refusing would
 * be telling somebody their own DNS does not work.
 */
export function looksLikeApex(domain: string): boolean {
  return domain.split('.').length === 2
}
