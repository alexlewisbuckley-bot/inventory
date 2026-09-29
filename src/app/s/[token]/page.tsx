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
  const houses = [...new Set(items.map((item) => item.brandName))]

  return (
    <main
      className="min-h-screen bg-white text-[color:var(--ink)] antialiased"
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

      {/*
        A masthead, not a colour slab.

        The banner was a block of brand colour with a title on it, which is what
        a template does when it has nothing to say. A shop says what is in it:
        the houses it carries, how many pieces, what they are quoted in — set
        like the opening of a catalogue. The brand colour earns its place as a
        rule and an accent rather than by filling the top of the screen.
      */}
      <section className="border-b border-[color:var(--hair)]">
        <div className="mx-auto max-w-[1400px] px-6 pb-12 pt-14 sm:px-10 sm:pb-14 sm:pt-20">
          <span className="block h-px w-16" style={{ backgroundColor: 'var(--accent)' }} aria-hidden />
          <h1 className="shop-serif mt-7 max-w-4xl text-[38px] font-medium leading-[1.06] sm:text-[62px]">
            {reseller.headline || 'The current collection'}
          </h1>
          {reseller.intro && (
            <p className="mt-5 max-w-xl text-[15px] leading-[1.7] text-[color:var(--ink-soft)]">
              {reseller.intro}
            </p>
          )}

          <dl className="mt-10 flex flex-wrap gap-x-14 gap-y-6 border-t border-[color:var(--hair)] pt-7">
            <div>
              <dt className="shop-eyebrow text-[color:var(--ink-mute)]">Available</dt>
              <dd className="shop-serif shop-num mt-1.5 text-[30px] font-medium leading-none">
                {items.length}
              </dd>
            </div>
            {houses.length > 0 && (
              <div>
                <dt className="shop-eyebrow text-[color:var(--ink-mute)]">Houses</dt>
                <dd className="shop-serif shop-num mt-1.5 text-[30px] font-medium leading-none">
                  {houses.length}
                </dd>
              </div>
            )}
            <div>
              <dt className="shop-eyebrow text-[color:var(--ink-mute)]">Quoted in</dt>
              <dd className="shop-serif mt-1.5 text-[30px] font-medium leading-none">{currency}</dd>
            </div>
            {priced > 0 && priced < items.length && (
              <div>
                <dt className="shop-eyebrow text-[color:var(--ink-mute)]">Priced</dt>
                <dd className="shop-serif shop-num mt-1.5 text-[30px] font-medium leading-none">
                  {priced}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </section>

      <ShopWindow
        items={items}
        token={params.token}
        currency={currency}
        contactEmail={reseller.contactEmail}
      />

      <footer className="border-t border-[color:var(--hair)]">
        <div className="mx-auto max-w-[1400px] px-6 py-14 sm:px-10">
          <div className="flex flex-wrap justify-between gap-10">
            <div className="max-w-sm">
              <span className="block h-px w-10" style={{ backgroundColor: 'var(--accent)' }} aria-hidden />
              <p className="shop-serif mt-5 text-[26px] font-medium leading-tight">{reseller.name}</p>
              {(reseller.contactEmail || reseller.contactPhone) && (
                <p className="mt-3 text-sm leading-relaxed text-[color:var(--ink-soft)]">
                  {reseller.contactName && <span className="block">{reseller.contactName}</span>}
                  {reseller.contactEmail && (
                    <a href={`mailto:${reseller.contactEmail}`} className="block hover:text-[color:var(--ink)]">
                      {reseller.contactEmail}
                    </a>
                  )}
                  {reseller.contactPhone && (
                    <a
                      href={`tel:${reseller.contactPhone.replace(/\s+/g, '')}`}
                      className="block hover:text-[color:var(--ink)]"
                    >
                      {reseller.contactPhone}
                    </a>
                  )}
                </p>
              )}
            </div>

            {reseller.navLinks.length > 0 && (
              <nav aria-label="More from this shop">
                <p className="shop-eyebrow text-[color:var(--ink-mute)]">Elsewhere</p>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {reseller.navLinks.map((link) => (
                    <li key={`${link.label}-${link.href}`}>
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-sm text-[color:var(--ink-soft)] transition hover:text-[color:var(--ink)]"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </div>

          <p className="mt-14 border-t border-[color:var(--hair)] pt-6 text-xs text-[color:var(--ink-mute)]">
            Availability and prices are live and may change without notice. All figures shown in {currency}.
          </p>
        </div>
      </footer>
    </main>
  )
}
