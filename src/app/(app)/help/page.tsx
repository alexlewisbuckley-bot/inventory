import type { Metadata } from 'next'
import Link from 'next/link'
import { BookOpen, Keyboard, LifeBuoy } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardHeader, CardBody } from '@/components/ui'

export const metadata: Metadata = { title: 'Help' }

const SHORTCUTS = [
  { keys: ['⌘', 'K'], action: 'Open search and commands', note: 'Ctrl-K on Windows' },
  { keys: ['↑', '↓'], action: 'Move through search results' },
  { keys: ['↵'], action: 'Open the highlighted result' },
  { keys: ['Esc'], action: 'Close any dialog, drawer or panel' },
  { keys: ['Tab'], action: 'Move forward through controls' },
  { keys: ['⇧', 'Tab'], action: 'Move backward through controls' },
]

const TASKS = [
  { title: 'Add a watch', body: 'Inventory → Add watch. Leave the sale price blank if you have not priced it yet; it will be flagged for review.', href: '/inventory/new' },
  { title: 'Move stock between stores', body: 'Open a watch and choose Move, or tick several rows in the inventory and use the bulk Move action. Every transfer is logged.', href: '/inventory' },
  { title: 'Record a sale', body: 'Open the watch and choose Record sale. Profit and margin are calculated as you type, and the watch moves to Sold.', href: '/inventory' },
  { title: 'Find slow-moving stock', body: 'Reports → Ageing stock lists everything held longer than the warning threshold, oldest first.', href: '/reports/ageing' },
  { title: 'Export for the accountant', body: 'Export CSV on the inventory or sales page. The export honours whatever filters you have applied.', href: '/sales' },
]

export default function HelpPage() {
  return (
    <>
      <PageHeader title="Help" description="How to get things done, and the shortcuts worth learning." />

      <div className="grid max-w-5xl gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Common tasks" />
          <ul className="divide-y divide-line-subtle">
            {TASKS.map((task) => (
              <li key={task.title} className="px-6 py-4">
                <Link href={task.href} className="text-body font-bold text-content-primary hover:underline">
                  {task.title}
                </Link>
                <p className="mt-1 text-small text-content-secondary">{task.body}</p>
              </li>
            ))}
          </ul>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Keyboard shortcuts" />
            <ul className="divide-y divide-line-subtle">
              {SHORTCUTS.map((shortcut) => (
                <li key={shortcut.action} className="flex items-center justify-between gap-4 px-6 py-3">
                  <div className="min-w-0">
                    <p className="text-small text-content-primary">{shortcut.action}</p>
                    {shortcut.note && <p className="text-caption text-content-secondary">{shortcut.note}</p>}
                  </div>
                  <span className="flex shrink-0 gap-1" aria-hidden>
                    {shortcut.keys.map((key) => (
                      <kbd key={key} className="rounded-[4px] border border-line-subtle bg-surface-subtle px-1.5 py-0.5 font-sans text-caption font-semibold text-content-secondary">
                        {key}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardBody className="flex flex-col gap-4">
              <Row icon={<BookOpen className="h-4 w-4" />} title="Where the data came from"
                body="Stock was migrated from the shared ChronoHub spreadsheet. Every watch kept its original stock number." />
              <Row icon={<Keyboard className="h-4 w-4" />} title="Accessibility"
                body="The whole application is keyboard operable, and animation respects your reduced-motion setting." />
              <Row icon={<LifeBuoy className="h-4 w-4" />} title="Something wrong?"
                body="Every change is in the audit trail, and deleted stock can be restored — nothing is really lost." />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}

function Row({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-surface-subtle text-content-secondary" aria-hidden>
        {icon}
      </span>
      <div>
        <p className="text-body font-bold text-content-primary">{title}</p>
        <p className="text-caption text-content-secondary">{body}</p>
      </div>
    </div>
  )
}
