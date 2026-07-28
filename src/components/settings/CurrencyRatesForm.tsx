'use client'
import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { AlertTriangle, Lock } from 'lucide-react'
import {
  Card, CardHeader, CardBody, CardFooter, Button, Chip,
  Table, THead, TBody, TR, TD, TH, useToast,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { updateRatesAction } from '@/app/actions/admin'
import type { ActionState } from '@/app/actions/auth'
import { formatDateTime } from '@/lib/dates'
import { RelativeTime } from '@/components/ui/RelativeTime'
import { BASE_CURRENCY, CURRENCY_LABELS, type CurrencyCode } from '@/lib/enums'

export interface RateView {
  code: CurrencyCode
  rate: number
  updatedAt: string
  updatedByName: string | null
}

const INITIAL: ActionState = { ok: false }

/** Rates older than this are called out — a stale rate quietly misprices stock. */
const STALE_AFTER_DAYS = 7

/**
 * Exchange rate management.
 *
 * Rates are entered by hand rather than pulled from a feed: the team agrees
 * deals at a rate they choose, and a live feed would re-price stock between
 * one page load and the next. Because that makes staleness a real risk, every
 * rate shows when it was last set and by whom, and anything older than a week
 * is flagged.
 */
export function CurrencyRatesForm({ rates, canManage }: { rates: RateView[]; canManage: boolean }) {
  const toast = useToast()
  const [state, action] = useFormState(updateRatesAction, INITIAL)

  useEffect(() => {
    if (state.ok && state.message) toast.success('Rates updated', state.message)
    else if (!state.ok && state.message) toast.error('Could not update rates', state.message)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const stale = rates.filter(
    (rate) => rate.code !== BASE_CURRENCY &&
      Date.now() - new Date(rate.updatedAt).getTime() > STALE_AFTER_DAYS * 86_400_000,
  )

  return (
    <form action={action} className="w-full">
      <Card>
        <CardHeader
          title="Exchange rates"
          description={`All amounts are stored in ${BASE_CURRENCY} and converted for display. Rates are entered manually — nothing changes them behind your back.`}
        />

        <CardBody className="flex flex-col gap-5">
          {!canManage && (
            <div className="flex items-start gap-2.5 rounded-md border border-line-subtle bg-surface-subtle px-4 py-3">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-content-secondary" aria-hidden />
              <p className="text-small text-content-secondary">
                Rates are read-only for your role. An owner can change them.
              </p>
            </div>
          )}

          {stale.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-md border border-state-gold/40 bg-state-gold/10 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-state-gold" aria-hidden />
              <p className="text-small text-content-secondary">
                <strong className="text-content-primary">
                  {stale.map((rate) => rate.code).join(', ')}
                </strong>{' '}
                {stale.length === 1 ? 'was' : 'were'} last updated over a week ago. Stock values
                shown in {stale.length === 1 ? 'that currency' : 'those currencies'} may be misleading.
              </p>
            </div>
          )}

          {/* A table, not a stack of ad-hoc rows. Each row was labelling its
              own input, so the first read "Rate" and the rest read "GBP → X",
              and the timestamp appeared twice in two different formats. One
              header row says it once and the columns line up. */}
          <div className="-mx-6 -mt-1 border-b border-line-subtle">
            <Table>
              <THead>
                <TR>
                  <TH width="200px">Currency</TH>
                  <TH width="220px">Rate per {BASE_CURRENCY}</TH>
                  <TH>Last updated</TH>
                </TR>
              </THead>
              <TBody>
                {rates.map((rate) => {
                  const isBase = rate.code === BASE_CURRENCY
                  const never = new Date(rate.updatedAt).getTime() === 0
                  return (
                    <TR key={rate.code}>
                      <TD>
                        <span className="block font-bold text-content-primary">{rate.code}</span>
                        <span className="block text-caption text-content-secondary">
                          {CURRENCY_LABELS[rate.code]}
                        </span>
                      </TD>
                      <TD>
                        {isBase ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="tabular-nums text-content-secondary">1.0000</span>
                            <Chip tone="neutral">Base</Chip>
                          </span>
                        ) : (
                          <>
                            <input
                              name={`rate.${rate.code}`}
                              // Four places, like the base row above it: 1.0000
                              // beside 10.3 reads as two different precisions
                              // of the same quantity.
                              defaultValue={rate.rate > 0 ? rate.rate.toFixed(4) : ''}
                              inputMode="decimal"
                              disabled={!canManage}
                              placeholder="0.0000"
                              aria-label={`${BASE_CURRENCY} to ${rate.code} rate`}
                              aria-invalid={state.errors?.[rate.code] ? true : undefined}
                              className={cn(
                                'h-11 w-36 rounded-md border bg-surface-raised px-3.5 text-body tabular-nums',
                                'text-content-primary transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                state.errors?.[rate.code]
                                  ? 'border-state-danger'
                                  : 'border-line-subtle hover:border-line-strong',
                              )}
                            />
                            {state.errors?.[rate.code] && (
                              <span className="mt-1 block text-caption text-state-danger">
                                {state.errors[rate.code]}
                              </span>
                            )}
                          </>
                        )}
                      </TD>
                      <TD className="text-content-secondary">
                        {isBase
                          ? 'Every stored amount is held in this currency.'
                          : never
                            ? 'Never set'
                            : (
                              <span title={formatDateTime(rate.updatedAt)}>
                                <RelativeTime value={rate.updatedAt} />
                                {rate.updatedByName ? ` · ${rate.updatedByName}` : ''}
                              </span>
                            )}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </div>

          <p className="text-caption text-content-secondary">
            Enter how many units of each currency one {BASE_CURRENCY} buys. For example, if
            £1 = 4.88&nbsp;AED, enter 4.88. Changing a rate re-values how existing stock is
            displayed; it never alters what was recorded.
          </p>
        </CardBody>

        {canManage && (
          <CardFooter>
            <span className="text-caption text-content-secondary">
              Historic purchases and sales keep the rate captured at the time.
            </span>
            <SaveButton />
          </CardFooter>
        )}
      </Card>
    </form>
  )
}

function SaveButton() {
  const { pending } = useFormStatus()
  return <Button type="submit" loading={pending}>Save rates</Button>
}
