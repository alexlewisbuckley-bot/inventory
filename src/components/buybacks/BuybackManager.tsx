'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import {
  AnchoredMenu, Button, Card, CardBody, Chip, IconButton, MoneyField, Modal, SelectField,
  StatCard, TextField, Table, THead, TBody, TR, TD, TH, EmptyState, useCurrency, useToast,
} from '@/components/ui'
import type { MenuItem } from '@/components/ui'
import { parseMoneyInput } from '@/lib/money'
import { formatDate } from '@/lib/dates'
import { BUYBACK_STATUS_LABELS, type BuybackStatus, type CurrencyCode } from '@/lib/enums'
import {
  defaultBuybackAction, markBuybackChargePaidAction, recordBuybackAction, redeemBuybackAction,
} from '@/app/actions/buybacks'

export interface BuybackRow {
  id: string
  reference: string | null
  customerName: string
  principalBase: number
  rateBps: number
  monthlyBase: number
  startedOn: string
  dueOn: string | null
  status: BuybackStatus
  chargedBase: number
  paidBase: number
  items: number
}

export interface ChargeRow {
  id: string
  buybackId: string
  kind: 'INTEREST' | 'EXTENSION'
  periodIndex: number | null
  dueOn: string
  amountBase: number
  paymentStatus: string
}

/**
 * Lending against watches, on one screen.
 *
 * The three figures a loan is actually about are the money out, the money
 * earned on it so far, and whether it is being paid — so those are the
 * columns, and everything else is behind the row. Interest is not typed
 * in: it builds up by itself every month the loan is open, which is why
 * there is nothing here to press to make the figures right.
 */
export function BuybackManager({ loans, charges, people, canWrite }: {
  loans: BuybackRow[]
  charges: ChargeRow[]
  people: Array<{ id: string; name: string }>
  canWrite: boolean
}) {
  const { money } = useCurrency()
  const router = useRouter()
  const toast = useToast()
  const [recording, setRecording] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [, start] = useTransition()

  const live = loans.filter((loan) => loan.status === 'OPEN')
  const lent = live.reduce((sum, loan) => sum + loan.principalBase, 0)
  const earned = loans.reduce((sum, loan) => sum + loan.chargedBase, 0)
  const owed = loans.reduce((sum, loan) => sum + (loan.chargedBase - loan.paidBase), 0)

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    start(async () => {
      const result = await fn()
      if (result.ok) toast.success(result.message ?? 'Done')
      else toast.error(result.message ?? 'That did not work')
      router.refresh()
    })
  }

  return (
    <>
      <section aria-label="Buy-back figures" className="mb-6 grid grid-cols-2 gap-3 sm:gap-6 xl:grid-cols-3">
        {/* Out on loan is capital, not cost. It is the easiest money in the
            business to forget about: not on a shelf, not in the bank. */}
        <StatCard label="Out on loan" value={money(lent)} caption={`${live.length} open`} />
        <StatCard label="Earned to date" value={money(earned)} tone="accent" caption="interest and fees" />
        <StatCard label="Awaiting payment" value={money(owed)} caption="charged but not received" />
      </section>

      {canWrite && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setRecording(true)} icon={<Plus className="h-4 w-4" />}>
            Record a buy-back
          </Button>
        </div>
      )}

      {loans.length === 0 ? (
        <EmptyState
          title="No buy-backs yet"
          description="A buy-back is money lent against watches you hold as security. The interest builds up by itself once one is written down."
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Customer</TH>
                <TH>Started</TH>
                <TH>Due</TH>
                <TH align="right">Advanced</TH>
                <TH align="right">Per month</TH>
                <TH align="right">Earned</TH>
                <TH align="right">Outstanding</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {loans.map((loan) => {
                const outstanding = loan.chargedBase - loan.paidBase
                const overdue = loan.status === 'OPEN' && loan.dueOn !== null
                  && new Date(loan.dueOn) < new Date()
                return (
                  <TR key={loan.id}>
                    <TD>
                      <button
                        type="button"
                        onClick={() => setOpen(open === loan.id ? null : loan.id)}
                        className="block text-left font-bold text-content-primary hover:underline"
                      >
                        {loan.customerName}
                      </button>
                      <span className="block text-caption text-content-secondary">
                        {loan.items} watch{loan.items === 1 ? '' : 'es'} held
                        {loan.reference ? ` · ${loan.reference}` : ''}
                      </span>
                    </TD>
                    <TD className="whitespace-nowrap text-content-secondary">{formatDate(new Date(loan.startedOn))}</TD>
                    <TD className="whitespace-nowrap">
                      {loan.dueOn ? (
                        <span className={overdue ? 'font-semibold text-state-danger' : 'text-content-secondary'}>
                          {formatDate(new Date(loan.dueOn))}
                        </span>
                      ) : <span className="text-content-secondary">—</span>}
                    </TD>
                    <TD align="right" className="font-bold">{money(loan.principalBase)}</TD>
                    {/* The rate as agreed and what it comes to, together:
                        either one alone is a figure somebody has to do
                        arithmetic on before it means anything. */}
                    <TD align="right" className="whitespace-nowrap text-content-secondary">
                      {money(loan.monthlyBase)}
                      <span className="block text-caption">{(loan.rateBps / 100).toFixed(2)}%</span>
                    </TD>
                    <TD align="right" className="text-content-secondary">{money(loan.chargedBase)}</TD>
                    <TD align="right" className={outstanding > 0 ? 'font-semibold text-state-warning' : 'text-content-secondary'}>
                      {outstanding > 0 ? money(outstanding) : '—'}
                    </TD>
                    <TD>
                      <Chip tone={loan.status === 'OPEN' ? 'navy' : loan.status === 'DEFAULTED' ? 'critical' : 'good'}>
                        {BUYBACK_STATUS_LABELS[loan.status]}
                      </Chip>
                    </TD>
                    <TD align="right">
                      {/* Behind one control, as the stock list and the
                          ledger both do. Side by side they ran off the
                          right-hand edge of the table, which puts the
                          irreversible one off-screen. */}
                      {canWrite && loan.status === 'OPEN' && (
                        <LoanMenu
                          label={`Actions for ${loan.customerName}`}
                          items={[
                            {
                              id: 'redeem',
                              label: 'They redeemed it',
                              onSelect: () => run(() => redeemBuybackAction(loan.id)),
                            },
                            {
                              id: 'default',
                              // What it will do, not what it is called:
                              // this is the one act here that cannot be
                              // undone, and it creates stock.
                              label: `Take the watch${loan.items === 1 ? '' : 'es'} into stock…`,
                              onSelect: () => run(() => defaultBuybackAction(loan.id)),
                              tone: 'danger' as const,
                              separated: true,
                            },
                          ]}
                        />
                      )}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </Card>
      )}

      {open && (
        <Card className="mt-4">
          <CardBody>
            <h2 className="mb-3 text-body font-bold text-content-primary">
              Charges on {loans.find((loan) => loan.id === open)?.customerName}&rsquo;s buy-back
            </h2>
            <Table>
              <THead>
                <TR><TH>Due</TH><TH>What for</TH><TH align="right">Amount</TH><TH>Paid</TH><TH /></TR>
              </THead>
              <TBody>
                {charges.filter((charge) => charge.buybackId === open).map((charge) => (
                  <TR key={charge.id}>
                    <TD className="whitespace-nowrap text-content-secondary">{formatDate(new Date(charge.dueOn))}</TD>
                    <TD>{charge.kind === 'EXTENSION' ? 'Extension fee' : `Interest, month ${charge.periodIndex}`}</TD>
                    <TD align="right" className="font-bold">{money(charge.amountBase)}</TD>
                    <TD>
                      <Chip tone={charge.paymentStatus === 'PAID' ? 'good' : 'warning'}>
                        {charge.paymentStatus === 'PAID' ? 'Paid' : 'Awaiting'}
                      </Chip>
                    </TD>
                    <TD align="right">
                      {canWrite && charge.paymentStatus !== 'PAID' && (
                        <Button size="sm" variant="ghost" onClick={() => run(() => markBuybackChargePaidAction(charge.id))}>
                          Payment received
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
                {charges.filter((charge) => charge.buybackId === open).length === 0 && (
                  <TR>
                    <TD className="text-content-secondary">
                      Nothing charged yet. The first month falls due a month after it started.
                    </TD>
                  </TR>
                )}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      <RecordBuyback
        open={recording}
        people={people}
        onClose={() => setRecording(false)}
        onDone={() => { setRecording(false); router.refresh() }}
      />
    </>
  )
}

/** One watch pledged against a loan, as the form holds it. */
interface ItemDraft {
  key: string
  description: string
  brand: string
  model: string
  serial: string
  year: string
  value: string
}

const blankItem = (): ItemDraft => ({
  key: Math.random().toString(36).slice(2),
  description: '', brand: '', model: '', serial: '', year: '', value: '',
})

/**
 * Writing one down.
 *
 * The rate is typed as a percentage because that is what was agreed —
 * "two and a half a month" — and the amount it comes to is shown as it is
 * typed, because that is the number the customer will be asked for. Both
 * on screen at once so neither has to be worked out in somebody's head,
 * which is where the figure gets wrong.
 */
function RecordBuyback({ open, people, onClose, onDone }: {
  open: boolean
  people: Array<{ id: string; name: string }>
  onClose: () => void
  onDone: () => void
}) {
  const { money } = useCurrency()
  const toast = useToast()
  const [, start] = useTransition()

  const [customerName, setCustomerName] = useState('')
  const [reference, setReference] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<CurrencyCode>('AED')
  const [ratePct, setRatePct] = useState('2.5')
  const [startedOn, setStartedOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [dueOn, setDueOn] = useState('')
  const [soldById, setSoldById] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<ItemDraft[]>([blankItem()])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setCustomerName(''); setReference(''); setAmount(''); setRatePct('2.5')
      setDueOn(''); setSoldById(''); setNotes(''); setItems([blankItem()])
      setErrors({}); setMessage(null)
    }
  }, [open])

  const principal = parseMoneyInput(amount) ?? 0
  const rateBps = Math.round((Number(ratePct) || 0) * 100)
  const monthly = Math.round((principal * rateBps) / 10_000)

  const submit = () => {
    setMessage(null)
    start(async () => {
      const result = await recordBuybackAction({
        reference: reference || null,
        customerName,
        principalAmount: principal,
        principalCurrency: currency,
        rateBps,
        startedOn,
        dueOn: dueOn || null,
        soldById: soldById || null,
        notes: notes || null,
        items: items
          .filter((item) => item.description.trim())
          .map((item) => ({
            description: item.description,
            brand: item.brand || null,
            model: item.model || null,
            serial: item.serial || null,
            year: item.year ? Number(item.year) : null,
            agreedAmount: item.value ? parseMoneyInput(item.value) : null,
          })),
      })
      if (result.ok) {
        toast.success(result.message ?? 'Recorded')
        onDone()
        return
      }
      // Always a sentence, never a silent failure: a panel that renders
      // only `message` and gets only `errors` looks like a dead button.
      setErrors(result.errors ?? {})
      setMessage(result.message ?? 'Could not record that.')
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record a buy-back"
      description="Money lent against watches you are holding. The interest builds up by itself each month."
      size="lg"
      dismissible={false}
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit}>Record it</Button>
        </div>
      )}
    >
      {message && (
        <p className="mb-4 rounded-md border border-state-danger/40 bg-state-danger/5 px-3 py-2 text-caption text-content-primary">
          {message}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Customer"
          value={customerName}
          onChange={(event) => setCustomerName(event.target.value)}
          error={errors.customerName}
          required
          autoFocus
        />
        <TextField
          label="Reference"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          hint="Yours, if you give these a number"
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <MoneyField
          label="Advanced to them"
          amount={amount}
          currency={currency}
          onAmountChange={setAmount}
          onCurrencyChange={setCurrency}
          error={errors.principalAmount}
          required
        />
        <TextField
          label="Interest per month"
          value={ratePct}
          onChange={(event) => setRatePct(event.target.value)}
          inputMode="decimal"
          prefix="%"
          hint={principal > 0 ? `${money(monthly)} a month` : 'As a percentage of what you lent'}
          error={errors.rateBps}
          required
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <TextField
          label="Started"
          type="date"
          value={startedOn}
          onChange={(event) => setStartedOn(event.target.value)}
          required
        />
        <TextField
          label="Due back"
          type="date"
          value={dueOn}
          onChange={(event) => setDueOn(event.target.value)}
          hint="When they should redeem"
        />
        <SelectField
          label="Written by"
          value={soldById}
          onChange={(event) => setSoldById(event.target.value)}
          options={people.map((person) => ({ value: person.id, label: person.name }))}
          placeholder="Not recorded"
        />
      </div>

      <fieldset className="mt-6">
        <legend className="text-small font-bold text-content-primary">Held as security</legend>
        <p className="mb-3 text-caption text-content-secondary">
          These stay out of your stock and off the website. They only become
          yours if the loan is not redeemed.
        </p>
        {items.map((item, index) => (
          <div key={item.key} className="mb-3 grid gap-3 sm:grid-cols-12">
            <TextField
              className="sm:col-span-4"
              label={index === 0 ? 'What it is' : undefined}
              value={item.description}
              onChange={(event) => setItems((all) => all.map((row) => (
                row.key === item.key ? { ...row, description: event.target.value } : row
              )))}
              placeholder="Rolex Daytona 116500LN"
            />
            <TextField
              className="sm:col-span-2"
              label={index === 0 ? 'Brand' : undefined}
              value={item.brand}
              onChange={(event) => setItems((all) => all.map((row) => (
                row.key === item.key ? { ...row, brand: event.target.value } : row
              )))}
            />
            <TextField
              className="sm:col-span-2"
              label={index === 0 ? 'Reference' : undefined}
              value={item.model}
              onChange={(event) => setItems((all) => all.map((row) => (
                row.key === item.key ? { ...row, model: event.target.value } : row
              )))}
            />
            <TextField
              className="sm:col-span-3"
              label={index === 0 ? 'Valued at' : undefined}
              value={item.value}
              onChange={(event) => setItems((all) => all.map((row) => (
                row.key === item.key ? { ...row, value: event.target.value } : row
              )))}
              inputMode="decimal"
              hint={index === 0 ? 'Splits the cost if it defaults' : undefined}
            />
            <div className="flex items-end sm:col-span-1">
              {items.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Remove this watch"
                  onClick={() => setItems((all) => all.filter((row) => row.key !== item.key))}
                  icon={<Trash2 className="h-4 w-4" />}
                />
              )}
            </div>
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={() => setItems((all) => [...all, blankItem()])}>
          Add another watch
        </Button>
      </fieldset>

      <div className="mt-4">
        <TextField
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
    </Modal>
  )
}

/** The trigger and its menu, so a row's verbs never run off the table. */
function LoanMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  return (
    <>
      <IconButton
        ref={anchor}
        variant="ghost"
        size="sm"
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        icon={<MoreHorizontal className="h-4 w-4" />}
      />
      <AnchoredMenu open={open} onClose={() => setOpen(false)} anchorRef={anchor} items={items} label={label} />
    </>
  )
}
