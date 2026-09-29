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
 * The tab, and what a shared link previews as.
 *
 * The headline used to sit in a masthead above the stock. Removing that section
 * left it with nowhere to go, and a field that renders nowhere is a field
 * somebody fills in for nothing — so it names the page instead, which is where
 * a shop's line about itself is most use: in the tab, in a bookmark, and in the
 * preview when the link is forwarded.
 *
 * Still not indexable. The link is a secret handed to one reseller, and a
 * search engine that finds it has revoked the access control on everybody's
 * behalf.
 */
export async function generateMetadata(
  { params }: { params: { token: string } },
): Promise<Metadata> {
  const shop = await getShopWindow(params.token, await getRateTable())
  if (!shop) return { robots: { index: false, follow: false, nocache: true } }
  const { reseller } = shop
  return {
    title: reseller.headline ? `${reseller.headline} · ${reseller.name}` : reseller.name,
    description: reseller.intro ?? undefined,
    robots: { index: false, follow: false, nocache: true },
  }
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

      <ShopWindow
        items={items}
        token={params.token}
        currency={currency}
        contactEmail={reseller.contactEmail}
        hasLogo={reseller.hasLogo}
        shopName={reseller.name}
      />

      <footer className="border-t border-[color:var(--hair)]">
        <div className="mx-auto max-w-[1400px] px-6 py-14 sm:px-10">
          <div className="flex flex-wrap justify-between gap-10">
            <div className="max-w-sm">
              <span className="block h-px w-10" style={{ backgroundColor: 'var(--accent)' }} aria-hidden />
              {/* The mark again on the way out, as a shop signs off. */}
              {reseller.hasLogo ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`/s/${params.token}/logo`}
                  alt={reseller.name}
                  className="mt-5 h-10 w-auto max-w-[190px] object-contain"
                />
              ) : (
                <p className="shop-serif mt-5 text-[26px] font-medium leading-tight">{reseller.name}</p>
              )}
              {reseller.intro && (
                <p className="mt-4 text-sm leading-[1.75] text-[color:var(--ink-soft)]">{reseller.intro}</p>
              )}
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
