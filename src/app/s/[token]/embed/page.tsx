import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getShopWindow } from '@/server/services/reseller-service'
import { getRateTable } from '@/server/services/fx-service'
import { ShopWindow } from '@/components/shop/ShopWindow'
import { EmbedHeight } from '@/components/shop/EmbedHeight'
import type { CurrencyCode } from '@/lib/enums'

/**
 * The same stock, with nothing around it.
 *
 * For the reseller who already has a website and does not want a second one.
 * This is the shop window without the masthead, the footer or the page
 * background, sized to whatever it contains and dropped into a div on their
 * own site by two lines of HTML — their domain, their navigation, their
 * typography above and below it, and no DNS to arrange.
 *
 * Their page supplies the frame, so this supplies none: no logo, because
 * theirs is already at the top of their own page, and no contact details,
 * because they are in their own footer.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function generateMetadata(): Promise<Metadata> {
  // Never indexed in its own right. What should be found is the reseller's
  // page, not the frame inside it.
  return { robots: { index: false, follow: false, nocache: true } }
}

export default async function ShopEmbedPage({ params }: { params: { token: string } }) {
  const rates = await getRateTable()
  const shop = await getShopWindow(params.token, rates)
  if (!shop) notFound()

  const { reseller, items } = shop

  return (
    <div
      className="bg-white text-[color:var(--ink)] antialiased"
      style={{
        ['--brand' as string]: reseller.brandColor,
        ['--accent' as string]: reseller.accentColor,
      }}
    >
      <EmbedHeight />
      <ShopWindow
        items={items}
        token={params.token}
        currency={reseller.displayCurrency as CurrencyCode}
        contactEmail={reseller.contactEmail}
        hasLogo={false}
        shopName={reseller.name}
        embedded
      />
    </div>
  )
}
