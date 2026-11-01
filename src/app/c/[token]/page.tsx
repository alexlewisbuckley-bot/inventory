import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getHouseCatalogue, noteCatalogueView } from '@/server/services/catalogue-link-service'
import { getSettings } from '@/server/services/settings-service'
import { TradeRoom } from '@/components/trade/TradeRoom'
import { hasBrandArtwork } from '@/lib/brand'

/**
 * What we have, for the trade.
 *
 * Alex: "Create a catalogue link that shows all the watches except in
 * transit & hong kong to show traders what we have with filtering and no
 * pricing."
 *
 * All four parts are somewhere else, deliberately. The stock and the
 * exclusions are in catalogue-link-service; the filtering and the absence of
 * prices are in TradeRoom, which was already a dealer list with no money in
 * it. This file is the door.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Says nothing, to anybody, ever.
 *
 * The link is a secret handed to a dealer, and a URL that previews as
 * "Trade stock · 94 watches" in a forwarded message has told the forwarding
 * half of the story to somebody who was never given the other half. Not
 * indexable for the same reason, only more so: a search engine that finds
 * this has revoked the access control on everybody's behalf.
 */
export const metadata: Metadata = {
  title: 'Trade catalogue',
  robots: { index: false, follow: false, nocache: true },
}

export default async function CatalogueLinkPage({ params }: { params: { token: string } }) {
  const catalogue = await getHouseCatalogue(params.token)
  // An unknown, revoked or switched-off link is the same nothing as one that
  // never existed. Anything more specific tells whoever is holding a dead
  // link that there is something real behind it.
  if (!catalogue) notFound()

  const settings = await getSettings()

  // Not awaited. It is a counter, and a link whose view failed to record is
  // still a link that should render.
  void noteCatalogueView(params.token)

  return (
    <TradeRoom
      token={params.token}
      basePath={`/c/${params.token}`}
      // No passphrase on this door, so there is nothing to leave.
      signOut={false}
      brand={{
        /*
         * Ours, not a reseller's.
         *
         * The supplied wordmark where there is one -- the same artwork the
         * application itself is headed with, so a dealer opening this
         * recognises who sent it. Where there is none, the trading name in
         * a serif, falling back to the company name: the trading name is
         * what the business is called out loud, and the company name is
         * the entity that appears on an invoice.
         */
        name: settings['company.tradingName'] || settings['company.name'] || 'Trade catalogue',
        logoSrc: hasBrandArtwork() ? '/brand/wordmark.svg' : null,
        brandColor: '#04173A',
        accentColor: '#0F766E',
      }}
      items={catalogue.items}
    />
  )
}
