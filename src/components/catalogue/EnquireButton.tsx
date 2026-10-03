'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquare } from 'lucide-react'
import {
  Modal, Button, MoneyField, SegmentedField, useToast, useCurrency,
} from '@/components/ui'
import { raiseEnquiryAction } from '@/app/actions/trade'
import { parseMoneyInput } from '@/lib/money'
import { toBase } from '@/lib/currency'
import {
  TRADE_ENQUIRY_KINDS, TRADE_ENQUIRY_KIND_LABELS, type CurrencyCode, type TradeEnquiryKind,
} from '@/lib/enums'

/**
 * A dealer saying they want something.
 *
 * It does not create a deal, and the copy says so: what it opens is a
 * conversation, and whether that becomes a deal is somebody else's decision.
 * Promising more than that in the button would have the board filling with
 * other people's intentions.
 */
export function EnquireButton({ watchId, label }: { watchId: string; label: string }) {
  const router = useRouter()
  const toast = useToast()
  const { currency: display, rates } = useCurrency()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<TradeEnquiryKind>('INTEREST')
  const [offer, setOffer] = useState('')
  const [currency, setCurrency] = useState<CurrencyCode>(display)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const minor = kind === 'OFFER' ? parseMoneyInput(offer) : null
    const result = await raiseEnquiryAction({
      watchId,
      kind,
      offerGbp: minor === null ? null : toBase(minor, currency, rates),
      message: message.trim() || null,
    })
    setBusy(false)
    if (!result.ok) { toast.error('Could not send that', result.message); return }
    toast.success('Sent', 'You will see the reply under Enquiries.')
    setOpen(false)
    setMessage('')
    setOffer('')
    router.refresh()
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        icon={<MessageSquare className="h-3.5 w-3.5" />}
        onClick={() => setOpen(true)}
      >
        Enquire
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Enquire about this"
        description={label}
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={submit} loading={busy} disabled={kind === 'OFFER' && !offer.trim()}>
              Send
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <SegmentedField
            name="kind"
            label="What are you asking"
            value={kind}
            onChange={setKind}
            options={TRADE_ENQUIRY_KINDS.map((k) => ({
              value: k,
              label: TRADE_ENQUIRY_KIND_LABELS[k],
              description: k === 'OFFER'
                ? 'Name a figure. It still has to be accepted.'
                : 'Condition, papers, anything you need to know.',
            }))}
          />

          {kind === 'OFFER' && (
            <MoneyField
              label="Your offer"
              amountName="offer"
              amount={offer}
              onAmountChange={setOffer}
              currency={currency}
              onCurrencyChange={setCurrency}
              autoFocus
            />
          )}

          <div>
            <label htmlFor="enquiry-message" className="text-caption font-semibold text-content-secondary">
              Message
            </label>
            <textarea
              id="enquiry-message"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={kind === 'OFFER'
                ? 'Anything that goes with the offer — timing, payment, collection.'
                : 'What would you like to know?'}
              className="mt-1.5 w-full rounded-md border border-line-subtle bg-surface-raised px-3.5 py-3 text-body text-content-primary placeholder:text-content-muted"
            />
          </div>

          <p className="text-caption text-content-secondary">
            This opens a conversation, not a sale. You will get the reply here under Enquiries.
          </p>
        </div>
      </Modal>
    </>
  )
}
