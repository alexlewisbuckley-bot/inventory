import { NextResponse, type NextRequest } from 'next/server'
import { hostOf, isOurHost, ownHosts, passesThrough } from '@/lib/domains'

/**
 * Whose site is this?
 *
 * A reseller pointing their own hostname at this deployment should get their
 * shop at the root of it, with nothing of ours in the address bar — not the
 * token, not our domain. That is the whole of what happens here: a request
 * arriving on a hostname that is not ours is rewritten into the shop route,
 * carrying the hostname where the token would have been. The shop looks up
 * either.
 *
 * A rewrite rather than a redirect, so the address bar keeps saying their
 * name. Redirecting would land the customer back on ours, which is exactly
 * the thing being fixed.
 *
 * It does no database work, on purpose. Middleware runs at the edge, on every
 * request, where there is no Node and no connection pool; the only question it
 * answers is "is this host one of ours", which is a string comparison. Whether
 * the hostname actually belongs to a reseller is settled one layer down, by
 * the page, with a real query — and an unknown hostname simply 404s there, as
 * an unknown token already does.
 *
 * `APP_HOSTS` is a comma-separated list of this deployment's own hostnames.
 * Platform names (`*.vercel.app`) and localhost are recognised without it;
 * anything else — a production domain of your own — has to be listed, or the
 * application will try to serve itself as somebody's shop.
 */
export function middleware(request: NextRequest) {
  const host = hostOf(request.headers.get('x-forwarded-host') ?? request.headers.get('host'))
  if (isOurHost(host, ownHosts(process.env.APP_HOSTS))) return NextResponse.next()

  const { pathname } = request.nextUrl
  // The shop's own assets already carry the key; rewriting them again would
  // bury it one level deeper and lose every logo and photograph.
  if (passesThrough(pathname)) return NextResponse.next()

  const url = request.nextUrl.clone()
  url.pathname = `/s/${host}${pathname === '/' ? '' : pathname}`
  return NextResponse.rewrite(url)
}

export const config = {
  // Static assets are served from our own origin whatever hostname asked for
  // them, so there is nothing here for them to decide.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
