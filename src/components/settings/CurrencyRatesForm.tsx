'use client'
import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { AlertTriangle, Lock } from 'lucide-react'
import { Card, CardHeader, CardBody, CardFooter, Button, TextField, Chip, useToast } from '@/components/ui'
import { updateRatesAction } from '@/app/actions/admin'
import type { ActionState } from '@/app/actions/auth'
import { formatDateTime, relativeTime } from '@/lib/dates'
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
    <form action={action} className="max-w-3xl">
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

          <ul className="flex flex-col gap-4">
            {rates.map((rate) => {
              const isBase = rate.code === BASE_CURRENCY
              const never = new Date(rate.updatedAt).getTime() === 0
              return (
                <li key={rate.code} className="flex flex-wrap items-end gap-4 border-b border-line-subtle pb-4 last:border-0">
                  <div className="w-28 shrink-0">
                    <p className="text-body font-extrabold text-content-primary">{rate.code}</p>
                    <p className="text-caption text-content-secondary">{CURRENCY_LABELS[rate.code]}</p>
                  </div>

                  <div className="w-44">
                    {isBase ? (
                      <div>
                        <p className="mb-1.5 text-caption font-semibold text-content-secondary">Rate</p>
                        <div className="flex h-[46px] items-center gap-2 rounded-md border border-line-subtle bg-surface-subtle px-3.5">
                          <span className="text-body text-content-secondary">1.0000</span>
                          <Chip tone="neutral">Base</Chip>
                        </div>
                      </div>
                    ) : (
                      <TextField
                        name={`rate.${rate.code}`}
                        label={`${BASE_CURRENCY} → ${rate.code}`}
                        defaultValue={rate.rate > 0 ? String(rate.rate) : ''}
                        inputMode="decimal"
                        disabled={!canManage}
                        placeholder="0.0000"
                        error={state.errors?.[rate.code]}
                      />
                    )}
                  </div>

                  <div className="min-w-[200px] flex-1">
                    <p className="text-caption text-content-secondary">
                      {isBase
                        ? 'Every stored amount is held in this currency.'
                        : never
                          ? 'Never set.'
                          : `Updated ${relativeTime(rate.updatedAt)}${rate.updatedByName ? ` by ${rate.updatedByName}` : ''}`}
                    </p>
                    {!isBase && !never && (
                      <p className="text-micro text-content-secondary" title={formatDateTime(rate.updatedAt)}>
                        {formatDateTime(rate.updatedAt)}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

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
