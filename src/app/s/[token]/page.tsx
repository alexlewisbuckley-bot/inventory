import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getShopWindow } from '@/server/services/reseller-service'
import { getRateTable } from '@/server/services/fx-service'
import { formatCurrency } from '@/lib/currency'
import {
  BOX_PAPERS_LABELS, CONDITION_LABELS, PRODUCT_TYPE_NOUNS,
  type BoxPapers, type Condition, type CurrencyCode, type ProductType,
} from '@/lib/enums'

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
      className="min-h-screen bg-white text-[#111827]"
      style={{
        // The reseller's colours, as custom properties so the whole page can
        // read from them without generating a stylesheet per reseller.
        ['--brand' as string]: reseller.brandColor,
        ['--accent' as string]: reseller.accentColor,
      }}
    >
      <header className="px-6 py-10 text-white sm:px-10 sm:py-14" style={{ backgroundColor: 'var(--brand)' }}>
        <div className="mx-auto flex max-w-6xl flex-col gap-5">
          {reseller.hasLogo && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={`/s/${params.token}/logo`}
              alt={reseller.name}
              className="h-14 w-auto max-w-[260px] object-contain object-left"
            />
          )}
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              {reseller.headline || reseller.name}
            </h1>
            {reseller.intro && (
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/80">{reseller.intro}</p>
            )}
          </div>
          <p className="text-sm font-semibold text-white/70">
            {items.length === 0
              ? 'No pieces available at the moment'
              : `${items.length} ${items.length === 1 ? 'piece' : 'pieces'} available now`}
            {priced < items.length && ` · ${items.length - priced} price on request`}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10 sm:px-10">
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#D1D5DB] px-6 py-16 text-center text-[#6B7280]">
            Everything is currently reserved or sold. Please check back shortly.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-col overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-sm"
              >
                <div className="flex aspect-square items-center justify-center bg-[#F3F4F6]">
                  {item.imageId ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`/s/${params.token}/image/${item.imageId}`}
                      alt={`${item.brandName} ${item.model}`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="text-sm text-[#9CA3AF]">
                      No photograph of this {PRODUCT_TYPE_NOUNS[item.productType as ProductType] ?? 'piece'}
                    </span>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-1 p-5">
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
                    {item.brandName}
                  </p>
                  <h2 className="text-lg font-bold leading-snug">{item.model}</h2>
                  {item.nickname && <p className="text-sm text-[#6B7280]">{item.nickname}</p>}

                  <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#6B7280]">
                    {item.year && (
                      <div className="flex gap-1"><dt>Year</dt><dd className="font-semibold text-[#374151]">{item.year}</dd></div>
                    )}
                    <div className="flex gap-1">
                      <dt>Condition</dt>
                      <dd className="font-semibold text-[#374151]">
                        {CONDITION_LABELS[item.condition as Condition] ?? item.condition}
                      </dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>Set</dt>
                      <dd className="font-semibold text-[#374151]">
                        {BOX_PAPERS_LABELS[item.boxPapers as BoxPapers] ?? item.boxPapers}
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-auto pt-4 text-xl font-extrabold tabular-nums">
                    {item.price === null
                      ? <span className="text-base font-semibold text-[#6B7280]">Price on request</span>
                      : formatCurrency(item.price, currency, { decimals: false })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {(reseller.contactEmail || reseller.contactPhone || reseller.website) && (
          <section className="mt-12 rounded-xl border border-[#E5E7EB] px-6 py-6">
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#6B7280]">Enquiries</h2>
            <p className="mt-2 text-[#374151]">
              {reseller.contactName ? `${reseller.contactName} · ` : ''}
              {reseller.name}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold" style={{ color: 'var(--accent)' }}>
              {reseller.contactEmail && <a href={`mailto:${reseller.contactEmail}`}>{reseller.contactEmail}</a>}
              {reseller.contactPhone && <a href={`tel:${reseller.contactPhone.replace(/\s+/g, '')}`}>{reseller.contactPhone}</a>}
              {reseller.website && (
                <a href={reseller.website} target="_blank" rel="noreferrer noopener">Website</a>
              )}
            </div>
          </section>
        )}

        <p className="mt-10 text-xs text-[#9CA3AF]">
          Availability and prices are live and can change without notice. Shown in {currency}.
        </p>
      </div>
    </main>
  )
}
