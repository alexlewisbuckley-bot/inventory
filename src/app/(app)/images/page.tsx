import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { photographedWatches } from '@/server/services/image-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { WatchImageWall } from '@/components/inventory/WatchImageWall'

export const metadata: Metadata = { title: 'Images for watches' }
export const dynamic = 'force-dynamic'

/**
 * Every photograph, under the serial of the watch in it.
 *
 * The stock list answers what is held and what it is worth, and shows one
 * photograph per watch as a way of recognising it. This answers the other
 * question: where is the picture, and what is it called when it leaves.
 *
 * That second half is the reason the page exists. Photographs arrive off a
 * phone as IMG_2841 through IMG_2921 — eighty in a row whose names say
 * nothing about which watch is in them. Attached to a watch here that stops
 * mattering; downloaded to send to a dealer it starts mattering again, and
 * the serial is the one name that means the same thing to everyone who sees
 * the file afterwards.
 */
export default async function WatchImagesPage() {
  await requireCapability('watch:read')
  const watches = await photographedWatches()

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Images' }]}
        title="Images for watches"
        description="Every photograph held, named after the serial of the watch in it. Click one to download it under that name."
      />
      <WatchImageWall watches={watches} />
    </>
  )
}
