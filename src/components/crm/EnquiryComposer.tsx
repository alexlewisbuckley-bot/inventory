'use client'

import { SelectField, TextField, TextareaField } from '@/components/ui'
import { Composer } from './Composer'
import { recordEnquiryAction } from '@/app/actions/crm'
import { REQUEST_ENQUIRY_STATUSES, REQUEST_ENQUIRY_STATUS_LABELS } from '@/lib/enums'

/**
 * Logging that a supplier was asked about a want.
 *
 * The reason this exists is duplication, not record-keeping. Sourcing a watch
 * means ringing round the same six dealers, and without a note of who has
 * already been asked, two people in the same office ask the same supplier the
 * same question on the same afternoon — which is embarrassing in a trade where
 * everyone knows everyone.
 *
 * The quote is optional because most first answers are "let me look", and
 * forcing a number would mean either a lie or an unlogged call.
 */
export function EnquiryComposer({ can, requestId, suppliers, label = 'Log a supplier enquiry' }: {
  can: boolean
  requestId: string
  suppliers: Array<{ id: string; name: string }>
  label?: string
}) {
  return (
    <Composer
      action={recordEnquiryAction}
      can={can}
      label={label}
      submitLabel="Log it"
      scope={{ requestId }}
      fields={() => (
        <>
          <SelectField
            name="supplierId"
            label="Who you asked"
            required
            placeholder="Choose a supplier…"
            options={suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              name="status"
              label="What they said"
              defaultValue="SENT"
              options={REQUEST_ENQUIRY_STATUSES.map((status) => ({
                value: status, label: REQUEST_ENQUIRY_STATUS_LABELS[status],
              }))}
            />
            <TextField
              name="quotedGbp"
              label="Quoted"
              prefix="£"
              inputMode="decimal"
              hint="Only if they gave a number."
            />
          </div>
          <TextareaField
            name="notes"
            label="Notes"
            rows={2}
            placeholder="Has one coming back from service in a fortnight."
            maxLength={2000}
          />
        </>
      )}
    />
  )
}
