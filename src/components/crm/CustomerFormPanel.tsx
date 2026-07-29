'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormState, useFormStatus } from 'react-dom'
import { Pencil, Plus } from 'lucide-react'
import {
  Button, Checkbox, Drawer, SegmentedField, SelectField, TextField, useToast,
} from '@/components/ui'
import { saveCustomerAction } from '@/app/actions/crm'
import { useCreateFlag } from '@/components/ui/CreateAction'
import {
  CONTACT_CHANNELS, CONTACT_CHANNEL_LABELS, CUSTOMER_STATUSES, CUSTOMER_STATUS_LABELS,
  CUSTOMER_TIERS, CUSTOMER_TIER_LABELS, CUSTOMER_TYPES, CUSTOMER_TYPE_DESCRIPTIONS,
  CUSTOMER_TYPE_LABELS, LEAD_SOURCES, LEAD_SOURCE_LABELS, PAYMENT_TERMS, PAYMENT_TERMS_LABELS,
  type CustomerType,
} from '@/lib/enums'
import { toMajor } from '@/lib/money'
import type { ActionState } from '@/app/actions/auth'

const INITIAL: ActionState = { ok: false }

export interface CustomerFormValues {
  id: string
  firstName: string
  lastName: string
  company: string | null
  email: string | null
  phone: string | null
  altPhone: string | null
  country: string | null
  city: string | null
  addressLine1: string | null
  addressLine2: string | null
  postcode: string | null
  preferredChannel: string
  tier: string
  customerType: string
  paymentTerms: string
  creditLimitGbp: number | null
  vatNo: string | null
  registrationNo: string | null
  supplierId: string | null
  status: string
  leadSource: string
  budgetMinGbp: number | null
  budgetMaxGbp: number | null
  birthday: string | null
  notes: string | null
  riskNotes: string | null
  marketingConsent: boolean
  ownerId: string | null
  brandIds: string[]
}

/**
 * Adding and editing a customer.
 *
 * In a drawer rather than on its own page: you are almost always looking at
 * something else when you need it — a list, a deal, a watch — and losing that
 * context to fill in a form is the tax that stops people recording anything.
 */
export function CustomerFormPanel({
  owners, brands, suppliers = [], customer, triggerLabel, variant = 'primary',
}: {
  owners: Array<{ id: string; name: string }>
  brands: Array<{ id: string; name: string }>
  suppliers?: Array<{ id: string; name: string }>
  customer?: CustomerFormValues
  triggerLabel: string
  variant?: 'primary' | 'secondary'
}) {
  const router = useRouter()
  const toast = useToast()
  const create = useCreateFlag()
  const [editing, setEditing] = useState(false)
  const [customerType, setCustomerType] = useState<CustomerType>(
    (customer?.customerType as CustomerType) ?? 'RETAIL',
  )
  const trade = customerType === 'TRADE'
  const [state, action] = useFormState(saveCustomerAction, INITIAL)

  const open = customer ? editing : create.open
  const close = () => (customer ? setEditing(false) : create.close())

  useEffect(() => {
    if (!state.ok) return
    close()
    toast.success(state.message ?? 'Saved')
    // A newly created customer is almost always the thing you want next.
    if (state.id && !customer) router.push(`/customers/${state.id}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return (
    <>
      <Button
        variant={variant}
        icon={customer ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        onClick={() => (customer ? setEditing(true) : create.openIt())}
      >
        {triggerLabel}
      </Button>

      <Drawer
        open={open}
        onClose={close}
        title={customer ? `Edit ${customer.firstName} ${customer.lastName}` : 'Add a customer'}
        subtitle={customer
          ? undefined
          : 'Only a name is required. Everything else can be filled in as you learn it.'}
      >
        <form action={action} className="flex flex-col gap-5">
          {customer && <input type="hidden" name="id" value={customer.id} />}

          {/* First, because it changes what the rest of the record means: a
              dealer is quoted differently, invoiced differently and spoken to
              differently from a private buyer. */}
          <SegmentedField
            name="customerType"
            label="Which side of the business"
            value={customerType}
            onChange={setCustomerType}
            options={CUSTOMER_TYPES.map((type) => ({
              value: type,
              label: CUSTOMER_TYPE_LABELS[type],
              description: CUSTOMER_TYPE_DESCRIPTIONS[type],
            }))}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="firstName" label="First name" required autoFocus
              defaultValue={customer?.firstName} error={state.errors?.firstName} />
            <TextField name="lastName" label="Surname" required
              defaultValue={customer?.lastName} error={state.errors?.lastName} />
            <TextField name="company" label="Company" className="sm:col-span-2"
              defaultValue={customer?.company ?? ''} />
            <TextField name="email" type="email" label="Email" autoComplete="off"
              defaultValue={customer?.email ?? ''} error={state.errors?.email} />
            <TextField name="phone" label="Phone" defaultValue={customer?.phone ?? ''} />
            <SelectField
              name="preferredChannel" label="Prefers to be contacted by"
              defaultValue={customer?.preferredChannel ?? 'EMAIL'}
              hint="Getting this wrong makes a responsive customer look unresponsive."
              options={CONTACT_CHANNELS.map((c) => ({ value: c, label: CONTACT_CHANNEL_LABELS[c] }))}
            />
            <TextField name="altPhone" label="Alternative number" defaultValue={customer?.altPhone ?? ''} />
          </div>

          <Fieldset legend="Where they are">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="addressLine1" label="Address" defaultValue={customer?.addressLine1 ?? ''} />
              <TextField name="addressLine2" label="Address line 2" defaultValue={customer?.addressLine2 ?? ''} />
              <TextField name="city" label="City" defaultValue={customer?.city ?? ''} />
              <TextField name="postcode" label="Postcode" defaultValue={customer?.postcode ?? ''} />
              <TextField name="country" label="Country" className="sm:col-span-2"
                defaultValue={customer?.country ?? ''} />
            </div>
          </Fieldset>

          <Fieldset legend={trade ? 'How we trade with them' : 'How they buy'}>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField name="tier" label="Tier" defaultValue={customer?.tier ?? 'STANDARD'}
                options={CUSTOMER_TIERS.map((t) => ({ value: t, label: CUSTOMER_TIER_LABELS[t] }))} />
              <SelectField name="leadSource" label="Where they came from"
                defaultValue={customer?.leadSource ?? 'UNKNOWN'}
                options={LEAD_SOURCES.map((s) => ({ value: s, label: LEAD_SOURCE_LABELS[s] }))} />

              {/* A dealer has no budget — they buy repeatedly, against terms.
                  Asking them for one, or asking a private buyer for a VAT
                  number, is how a form teaches people to ignore it. */}
              {trade ? (
                <>
                  <SelectField name="paymentTerms" label="Payment terms"
                    defaultValue={customer?.paymentTerms ?? 'UNKNOWN'}
                    options={PAYMENT_TERMS.map((t) => ({ value: t, label: PAYMENT_TERMS_LABELS[t] }))} />
                  <TextField name="creditLimitGbp" label="Credit limit" prefix="£" inputMode="decimal"
                    hint="What we are willing to have outstanding at once."
                    defaultValue={customer?.creditLimitGbp ? String(toMajor(customer.creditLimitGbp)) : ''} />
                  <TextField name="registrationNo" label="Company number"
                    defaultValue={customer?.registrationNo ?? ''} />
                  <TextField name="vatNo" label="VAT number"
                    defaultValue={customer?.vatNo ?? ''} />
                  <SelectField name="supplierId" label="Also a supplier" placeholder="Not on the buying side"
                    className="sm:col-span-2"
                    hint="Dealers usually sell to us as well. Linking them keeps one relationship in one place."
                    defaultValue={customer?.supplierId ?? ''}
                    options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
                </>
              ) : (
                <>
                  <TextField name="budgetMinGbp" label="Budget from" prefix="£" inputMode="decimal"
                    defaultValue={customer?.budgetMinGbp ? String(toMajor(customer.budgetMinGbp)) : ''} />
                  <TextField name="budgetMaxGbp" label="Budget to" prefix="£" inputMode="decimal"
                    hint="Used to suggest stock they might want."
                    defaultValue={customer?.budgetMaxGbp ? String(toMajor(customer.budgetMaxGbp)) : ''}
                    error={state.errors?.budgetMaxGbp} />
                </>
              )}

              <fieldset className="sm:col-span-2">
                <legend className="text-caption font-semibold text-content-secondary">Brands they buy</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {brands.map((brand) => (
                    <label
                      key={brand.id}
                      className="inline-flex cursor-pointer items-center gap-2 rounded-pill border border-line-subtle px-3.5 py-2 text-small text-content-primary transition-colors hover:border-line-strong has-[:checked]:border-teal-500 has-[:checked]:bg-teal-100"
                    >
                      <input
                        type="checkbox"
                        name="brandIds"
                        value={brand.id}
                        defaultChecked={customer?.brandIds.includes(brand.id)}
                        className="h-4 w-4 rounded-xs accent-teal-500"
                      />
                      {brand.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </Fieldset>

          <Fieldset legend="Relationship">
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField name="ownerId" label="Looked after by" placeholder="Unassigned"
                defaultValue={customer?.ownerId ?? ''}
                options={owners.map((o) => ({ value: o.id, label: o.name }))} />
              {!trade && (
                <TextField name="birthday" type="date" label="Birthday"
                  hint="Used for the reminder on the dashboard."
                  defaultValue={customer?.birthday ?? ''} />
              )}
              <SelectField name="status" label="Status" defaultValue={customer?.status ?? 'ACTIVE'}
                options={CUSTOMER_STATUSES.map((s) => ({ value: s, label: CUSTOMER_STATUS_LABELS[s] }))} />
              <div className="flex items-end pb-1">
                <Checkbox
                  name="marketingConsent"
                  label={trade ? 'Happy to receive stock lists' : 'Happy to receive marketing'}
                  hint="Recorded with the date, because consent without one is not consent."
                  defaultChecked={customer?.marketingConsent}
                />
              </div>
              <Note name="notes" label="Notes"
                placeholder={trade
                  ? 'What they take, what they pay, how quickly they move.'
                  : 'What they collect, how they like to be dealt with.'}
                defaultValue={customer?.notes ?? ''} />
              <Note name="riskNotes" label="Anything to be careful about"
                placeholder="Payment history, disputes, identification checks."
                defaultValue={customer?.riskNotes ?? ''} />
            </div>
          </Fieldset>

          {state.message && !state.ok && (
            <p role="alert" className="text-small text-state-danger">{state.message}</p>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-line-subtle pt-4">
            <Button variant="ghost" type="button" onClick={close}>Cancel</Button>
            <SaveButton label={customer ? 'Save changes' : 'Add customer'} />
          </div>
        </form>
      </Drawer>
    </>
  )
}

function Fieldset({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-t border-line-subtle pt-5">
      <legend className="pr-2 text-small font-bold text-content-primary">{legend}</legend>
      <div className="mt-3">{children}</div>
    </fieldset>
  )
}

function Note({ name, label, placeholder, defaultValue }: {
  name: string; label: string; placeholder: string; defaultValue: string
}) {
  return (
    <div className="sm:col-span-2">
      <label htmlFor={name} className="text-caption font-semibold text-content-secondary">{label}</label>
      <textarea
        id={name}
        name={name}
        rows={3}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="mt-1.5 w-full rounded-md border border-line-subtle bg-surface-raised px-3.5 py-3 text-body text-content-primary placeholder:text-content-secondary"
      />
    </div>
  )
}

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return <Button type="submit" loading={pending}>{label}</Button>
}
