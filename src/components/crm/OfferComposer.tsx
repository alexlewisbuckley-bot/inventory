'use client'

import { SelectField, TextField, TextareaField } from '@/components/ui'
import { Composer } from './Composer'
import { createOfferAction } from '@/app/actions/crm'
import { CURRENCIES, CURRENCY_LABELS } from '@/lib/enums'

/**
 * Recording an offer that was made.
 *
 * Note the currency field, and note that it is not decoration. Offers get made
 * in the currency the conversation is happening in — a Dubai trade call is
 * quoted in dirhams — and the action converts to GBP once, on the way in, so
 * that every report can add offers together without knowing where they came
 * from. Storing "42,000" with no currency is how a pipeline ends up reporting
 * a number nobody can reproduce.
 *
 * A validity date is offered but not required. An offer with no expiry is the
 * normal case in the trade; one with an expiry generates the chase.
 */
export function OfferComposer({ can, scope, defaultCurrency = 'GBP', label = 'Record an offer' }: {
  can: boolean
  scope: { customerId?: string | null; watchId?: string | null; dealId?: string | null }
  defaultCurrency?: string
  label?: string
}) {
  return (
    <Composer
      action={createOfferAction}
      can={can}
      label={label}
      submitLabel="Record it"
      scope={{
        customerId: scope.customerId ?? undefined,
        watchId: scope.watchId ?? undefined,
        dealId: scope.dealId ?? undefined,
      }}
      fields={(state) => (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              name="amount"
              label="Amount"
              required
              inputMode="decimal"
              placeholder="42000"
              className="sm:col-span-2"
              error={state.errors?.amount}
            />
            <SelectField
              name="currency"
              label="Currency"
              defaultValue={defaultCurrency}
              options={CURRENCIES.map((code) => ({
                value: code, label: `${code} — ${CURRENCY_LABELS[code]}`,
              }))}
            />
          </div>
          <TextField
            name="validUntil"
            type="date"
            label="Good until"
            hint="Leave blank if it was not put on a clock."
          />
          <TextareaField
            name="notes"
            label="Context"
            rows={2}
            placeholder="Verbal, on the phone. Said he would think about it over the weekend."
            maxLength={2000}
          />
        </>
      )}
    />
  )
}
