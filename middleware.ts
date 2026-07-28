import { NextResponse, type NextRequest } from 'next/server'

/**
 * Edge guard.
 *
 * Only checks for the presence of a session cookie — cryptographic
 * verification needs Node APIs and happens in `getSessionUser`. This keeps
 * unauthenticated traffic off the app routes cheaply; it is a redirect
 * optimisation, never the authorisation boundary.
 */
const PUBLIC_PATHS = ['/login', '/forgot-password']
const COOKIE = 'bluecroft_session'

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const hasSession = request.cookies.has(COOKIE)
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`
    return NextResponse.redirect(url)
  }

  if (hasSession && isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api/health|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
