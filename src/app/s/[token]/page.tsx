import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getShopWindow } from '@/server/services/reseller-service'
import { getRateTable } from '@/server/services/fx-service'
import { ShopWindow } from '@/components/shop/ShopWindow'
import { ShopHeader } from '@/components/shop/ShopHeader'
import type { CurrencyCode } from '@/lib/enums'

/**
 * Live: read on every request, never cached.
 *
 * The whole promise of this page is that it shows what is actually available.
 * A watch sold five minutes ago must be gone from it, so there is no
 * revalidation window to be wrong inside.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Not indexable.
 *
 * The link is a secret handed to one reseller. A search engine that finds it
 * and publishes it has revoked the access control on everybody's behalf.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
}

export default async function ShopWindowPage({ params }: { params: { token: string } }) {
  const rates = await getRateTable()
  const shop = await getShopWindow(params.token, rates)
  // An unknown, revoked or switched-off link is the same nothing as one that
  // never existed. Anything more specific tells whoever is holding a dead link
  // that there is something real behind it.
  if (!shop) notFound()

  const { reseller, items } = shop
  const currency = reseller.displayCurrency as CurrencyCode
  const priced = items.filter((item) => item.price !== null).length

  return (
    <main
      className="min-h-screen bg-white text-[#111827] antialiased"
      style={{
        // The reseller's colours, as custom properties so the whole page reads
        // from them without generating a stylesheet per reseller.
        ['--brand' as string]: reseller.brandColor,
        ['--accent' as string]: reseller.accentColor,
      }}
    >
      <ShopHeader
        name={reseller.name}
        token={params.token}
        hasLogo={reseller.hasLogo}
        links={reseller.navLinks}
        website={reseller.website}
      />

      {/* A band, not a hero. It says what this page is and how much is on it,
          then gets out of the way — the stock is what somebody came for, and
          the previous version pushed all of it below the fold. */}
      <section className="relative overflow-hidden text-white" style={{ backgroundColor: 'var(--brand)' }}>
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(90% 160% at 12% -40%, rgba(255,255,255,0.20), transparent 62%)' }}
          aria-hidden
        />
        <div className="relative mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-x-10 gap-y-4 px-6 py-8 sm:px-10 sm:py-10">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold leading-tight tracking-tight sm:text-[32px]">
              {reseller.headline || 'Available now'}
            </h1>
            {reseller.intro && (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/75 sm:text-base">
                {reseller.intro}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            <span className="inline-flex items-baseline gap-2">
              <span className="text-xl font-extrabold tabular-nums">{items.length}</span>
              <span className="text-white/70">{items.length === 1 ? 'piece' : 'pieces'}</span>
            </span>
            {priced > 0 && (
              <span className="inline-flex items-baseline gap-2">
                <span className="text-xl font-extrabold tabular-nums">{priced}</span>
                <span className="text-white/70">priced in {currency}</span>
              </span>
            )}
          </div>
        </div>
      </section>

      <ShopWindow
        items={items}
        token={params.token}
        currency={currency}
        contactEmail={reseller.contactEmail}
      />

      <footer className="border-t border-black/5 bg-[#FAFAFA]">
        <div className="mx-auto max-w-7xl px-6 py-10 sm:px-10">
          {(reseller.contactEmail || reseller.contactPhone || reseller.website) && (
            <>
              <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-[#6B7280]">Enquiries</h2>
              <p className="mt-2 text-lg font-bold text-[#111827]">
                {reseller.contactName ? `${reseller.contactName} · ` : ''}{reseller.name}
              </p>
              <div className="mt-3 flex flex-wrap gap-x-7 gap-y-2 text-sm font-semibold" style={{ color: 'var(--accent)' }}>
                {reseller.contactEmail && <a href={`mailto:${reseller.contactEmail}`}>{reseller.contactEmail}</a>}
                {reseller.contactPhone && (
                  <a href={`tel:${reseller.contactPhone.replace(/\s+/g, '')}`}>{reseller.contactPhone}</a>
                )}
                {reseller.website && <a href={reseller.website} target="_blank" rel="noreferrer noopener">Website</a>}
              </div>
            </>
          )}
          {reseller.navLinks.length > 0 && (
            <nav className="mt-6 flex flex-wrap gap-x-7 gap-y-2" aria-label="More from this shop">
              {reseller.navLinks.map((link) => (
                <a
                  key={`${link.label}-${link.href}`}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm font-semibold text-[#374151] hover:underline"
                >
                  {link.label}
                </a>
              ))}
            </nav>
          )}
          <p className="mt-8 text-xs text-[#9CA3AF]">
            Availability and prices are live and can change without notice. Shown in {currency}.
          </p>
        </div>
      </footer>
    </main>
  )
}
