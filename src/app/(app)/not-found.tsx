import Link from 'next/link'
import { PackageSearch } from 'lucide-react'
import { Card, EmptyState, LinkButton } from '@/components/ui'

/**
 * A missing record, inside the application shell.
 *
 * Following a stale link used to drop the user onto a bare page with no
 * navigation, so the only way back was the browser's back button. Keeping the
 * sidebar means a dead link costs one click rather than losing your place.
 */
export default function AppNotFound() {
  return (
    <Card className="mt-4">
      <EmptyState
        icon={<PackageSearch className="h-6 w-6" />}
        title="We can’t find that record"
        description="The link may be out of date, or the record may have been deleted. Deleted stock is still searchable from the inventory."
        action={
          <div className="flex flex-wrap items-center justify-center gap-3">
            <LinkButton href="/inventory">Go to the inventory</LinkButton>
            <Link href="/" className="text-small font-bold text-content-accent hover:underline">
              Back to the dashboard
            </Link>
          </div>
        }
      />
    </Card>
  )
}
