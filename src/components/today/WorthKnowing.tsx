import Link from 'next/link'
import { ArrowRight, CircleAlert, Sparkles, Wrench } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui'
import type { Notice, NoticeTone } from '@/server/services/insights-service'
import { cn } from '@/lib/cn'

const ICON: Record<NoticeTone, typeof Sparkles> = {
  opportunity: Sparkles,
  attention: CircleAlert,
  housekeeping: Wrench,
}

const TINT: Record<NoticeTone, string> = {
  opportunity: 'text-content-accent',
  attention: 'text-state-gold',
  housekeeping: 'text-content-secondary',
}

/**
 * The one place the system tells you something you did not ask it.
 *
 * V1 had matching, quiet contacts, stale rates and ageing stock each inventing
 * its own notification, which produced four half-configured systems and a bell
 * with a permanent unread badge that everybody learned to ignore. They report
 * here instead, in one ordered list.
 *
 * Every line ends in the action that resolves it. That is the rule that keeps
 * this from becoming another feed: a notice you cannot act on from where you
 * are reading it is a notice that gets read again tomorrow, and the day after.
 */
export function WorthKnowing({ notices }: { notices: Notice[] }) {
  return (
    <Card as="section">
      <CardHeader
        title="Worth knowing"
        description="Things the system noticed. Each one has something you can do about it."
      />
      {notices.length === 0 ? (
        <CardBody className="text-small text-content-secondary">
          Nothing to flag. Stock is priced, rates are current, and nobody has been left waiting.
        </CardBody>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {notices.map((notice) => {
            const Icon = ICON[notice.tone]
            return (
              <li key={notice.id} className="flex items-start gap-3 px-6 py-3.5">
                <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TINT[notice.tone])} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-small font-semibold text-content-primary">{notice.headline}</p>
                  {notice.detail && (
                    <p className="mt-0.5 text-caption text-content-secondary">{notice.detail}</p>
                  )}
                </div>
                <Link
                  href={notice.action.href}
                  className="inline-flex shrink-0 items-center gap-1 text-caption font-semibold text-content-accent hover:underline"
                >
                  {notice.action.label}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
