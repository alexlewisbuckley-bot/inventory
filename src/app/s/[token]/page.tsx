import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getShopWindow } from '@/server/services/reseller-service'
import { getRateTable } from '@/server/services/fx-service'
import { ShopWindow } from '@/components/shop/ShopWindow'
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
      <header className="relative overflow-hidden text-white" style={{ backgroundColor: 'var(--brand)' }}>
        {/* Depth without a second colour choice to get wrong: the reseller
            picks one brand colour and the banner shades itself from it. */}
        <div
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{ background: 'radial-gradient(120% 140% at 15% -20%, rgba(255,255,255,0.22), transparent 60%)' }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-7xl px-6 py-12 sm:px-10 sm:py-16">
          {reseller.hasLogo ? (
            /* On a white plate, because a logo is drawn for a light background
               far more often than a dark one, and a dark-on-dark wordmark is
               the commonest way a page like this looks broken. */
            <span className="mb-7 inline-flex items-center justify-center rounded-xl bg-white px-5 py-3.5 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/s/${params.token}/logo`}
                alt={reseller.name}
                className="h-11 w-auto max-w-[240px] object-contain"
              />
            </span>
          ) : (
            <p className="mb-5 text-sm font-bold uppercase tracking-[0.22em] text-white/70">
              {reseller.name}
            </p>
          )}

          <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
            {reseller.headline || 'Available now'}
          </h1>
          {reseller.intro && (
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/75 sm:text-lg">
              {reseller.intro}
            </p>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
            <span className="inline-flex items-baseline gap-2">
              <span className="text-2xl font-extrabold tabular-nums">{items.length}</span>
              <span className="text-white/70">{items.length === 1 ? 'piece available' : 'pieces available'}</span>
            </span>
            {priced > 0 && (
              <span className="inline-flex items-baseline gap-2">
                <span className="text-2xl font-extrabold tabular-nums">{priced}</span>
                <span className="text-white/70">priced in {currency}</span>
              </span>
            )}
          </div>
        </div>
      </header>

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
          <p className="mt-8 text-xs text-[#9CA3AF]">
            Availability and prices are live and can change without notice. Shown in {currency}.
          </p>
        </div>
      </footer>
    </main>
  )
}
