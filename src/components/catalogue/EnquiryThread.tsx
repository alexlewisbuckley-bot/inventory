'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, Send, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, Card, useToast } from '@/components/ui'
import { decideEnquiryAction, replyToEnquiryAction } from '@/app/actions/trade'
import { formatDateTime } from '@/lib/dates'

export interface ThreadMessage {
  id: string
  body: string
  authorId: string | null
  authorName: string | null
  createdAt: string
}

/**
 * The conversation, and — for the owner — the answer.
 *
 * Both sides read the same thread. What differs is the footer: a dealer gets
 * a box to write in, the owner gets that and the two buttons that end it.
 * Approving is the only thing on this page that creates a deal, which is the
 * gate the whole feature exists for.
 */
export function EnquiryThread({
  enquiryId, meId, messages, open, canDecide, dealHref,
}: {
  enquiryId: string
  meId: string
  messages: ThreadMessage[]
  /** Still open, so still answerable. */
  open: boolean
  canDecide: boolean
  dealHref: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState<'reply' | 'approve' | 'decline' | null>(null)

  const send = async () => {
    if (!body.trim()) return
    setBusy('reply')
    const result = await replyToEnquiryAction(enquiryId, body)
    setBusy(null)
    if (!result.ok) { toast.error('Could not send that', result.message); return }
    setBody('')
    router.refresh()
  }

  const decide = async (decision: 'APPROVED' | 'DECLINED') => {
    setBusy(decision === 'APPROVED' ? 'approve' : 'decline')
    // Whatever is in the box goes with the decision, so "no, too high" is one
    // action rather than a message and then a button.
    const result = await decideEnquiryAction(enquiryId, decision, body)
    setBusy(null)
    if (!result.ok) { toast.error('Could not record that', result.message); return }
    setBody('')
    toast.success(result.message ?? 'Done')
    router.refresh()
  }

  return (
    <Card className="overflow-hidden">
      <ul className="flex flex-col gap-3 px-5 py-5">
        {messages.length === 0 && (
          <li className="text-small text-content-secondary">Nothing said yet.</li>
        )}
        {messages.map((message) => {
          const mine = message.authorId === meId
          return (
            <li key={message.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[80%] rounded-md px-3.5 py-2.5',
                mine ? 'bg-teal-100 text-content-primary' : 'bg-surface-subtle text-content-primary',
              )}>
                <p className="whitespace-pre-wrap text-small">{message.body}</p>
                <p className="mt-1 text-caption text-content-secondary">
                  {message.authorName ?? 'Someone'} · {formatDateTime(message.createdAt)}
                </p>
              </div>
            </li>
          )
        })}
      </ul>

      {dealHref && (
        <p className="border-t border-line-subtle bg-surface-subtle px-5 py-3 text-small text-content-secondary">
          Approved — it is on the board as{' '}
          <Link href={dealHref} className="font-semibold text-content-accent hover:underline">a deal</Link>.
        </p>
      )}

      {open ? (
        <div className="border-t border-line-subtle px-5 py-4">
          <label htmlFor="reply" className="text-caption font-semibold text-content-secondary">
            {canDecide ? 'Reply, or say why' : 'Reply'}
          </label>
          <textarea
            id="reply"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={canDecide
              ? 'Anything you write here goes with whichever button you press.'
              : 'Write a message'}
            className="mt-1.5 w-full rounded-md border border-line-subtle bg-surface-raised px-3.5 py-3 text-body text-content-primary placeholder:text-content-muted"
          />
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <Button
              variant={canDecide ? 'secondary' : 'primary'}
              icon={<Send className="h-3.5 w-3.5" />}
              onClick={send}
              loading={busy === 'reply'}
              disabled={!body.trim() || busy !== null}
            >
              Send
            </Button>
            {canDecide && (
              <>
                <Button
                  variant="ghost"
                  icon={<X className="h-3.5 w-3.5" />}
                  onClick={() => decide('DECLINED')}
                  loading={busy === 'decline'}
                  disabled={busy !== null}
                >
                  Decline
                </Button>
                <Button
                  icon={<Check className="h-3.5 w-3.5" />}
                  onClick={() => decide('APPROVED')}
                  loading={busy === 'approve'}
                  disabled={busy !== null}
                >
                  Approve · open a deal
                </Button>
              </>
            )}
          </div>
        </div>
      ) : (
        <p className="border-t border-line-subtle px-5 py-4 text-small text-content-secondary">
          This enquiry has been answered.
        </p>
      )}
    </Card>
  )
}
