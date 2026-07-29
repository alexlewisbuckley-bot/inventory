'use client'

import { useState } from 'react'
import { ComboSelect, SelectField, TextField, TextareaField, useToast } from '@/components/ui'
import { Composer } from './Composer'
import { quickCreateCustomerAction, saveRequestAction } from '@/app/actions/crm'
import {
  BOX_PAPERS, BOX_PAPERS_LABELS, CONDITIONS, CONDITION_LABELS,
  PRIORITIES, PRIORITY_LABELS,
} from '@/lib/enums'

/**
 * Registering what somebody is looking for.
 *
 * A drawer rather than an inline row: this is eleven fields, and eleven fields
 * growing out of a sidebar panel would push the record you were reading off
 * the screen.
 *
 * Every field except the customer is optional, deliberately. "Something in
 * steel, about twenty grand" is a real request and the commonest kind; a form
 * that insists on a reference number turns it into a note nobody can search.
 * The matcher already treats a missing budget as "no ceiling" and a missing
 * model as "any", so a sparse want still gets told when something arrives.
 */
export function WantComposer({ can, customerId, customers, brands, owners, label = 'Add a want' }: {
  can: boolean
  /** Fixed when the composer sits on a customer's record. */
  customerId?: string
  /** Supplied instead, when it does not — the wanted list itself. */
  customers?: Array<{ id: string; name: string }>
  brands: Array<{ id: string; name: string }>
  owners: Array<{ id: string; name: string }>
  label?: string
}) {
  const toast = useToast()
  const [chosen, setChosen] = useState('')

  return (
    <Composer
      action={saveRequestAction}
      can={can}
      presentation="drawer"
      label={label}
      title="What are they looking for?"
      subtitle="Register it and you will be told the moment something matching is booked in."
      submitLabel="Register it"
      scope={customerId ? { customerId } : undefined}
      onDone={() => setChosen('')}
      fields={(state) => (
        <>
          {/* Away from a customer record, the want needs somebody to belong
              to — and the person asking is very often somebody who has just
              walked in, so adding them has to be possible from here rather
              than on a different screen. */}
          {!customerId && (
            <ComboSelect
              name="customerId"
              label="Who is asking"
              value={chosen}
              onChange={setChosen}
              placeholder={customers?.length ? 'Choose a customer…' : 'Type their name and add them'}
              createLabel="Add"
              error={state.errors?.customerId}
              hint="Not on the book? Type their name and add them here."
              onCreate={async (name) => {
                const result = await quickCreateCustomerAction(name)
                if (!result.ok || !result.id) {
                  toast.error('Could not add the customer', result.message)
                  return null
                }
                toast.success(`${result.label} added`, 'Fill in the rest on their record later.')
                return { value: result.id, label: result.label ?? name }
              }}
              options={(customers ?? []).map((customer) => ({
                value: customer.id, label: customer.name,
              }))}
            />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              name="brandId"
              label="Brand"
              placeholder="Any brand"
              options={brands.map((brand) => ({ value: brand.id, label: brand.name }))}
            />
            <TextField name="model" label="Model" placeholder="Daytona" maxLength={80} />
            <TextField name="referenceNo" label="Reference" placeholder="126500LN" maxLength={60} />
            <TextField name="dial" label="Dial" placeholder="White" maxLength={60} />
            <TextField name="bracelet" label="Bracelet" placeholder="Oyster" maxLength={60} />
            <TextField
              name="budgetGbp"
              label="Budget"
              prefix="£"
              inputMode="decimal"
              hint="What they will go to. Leave blank if it has not come up."
              error={state.errors?.budgetGbp}
            />
            <SelectField
              name="condition"
              label="Condition"
              defaultValue="UNKNOWN"
              options={CONDITIONS.map((c) => ({ value: c, label: CONDITION_LABELS[c] }))}
            />
            <SelectField
              name="boxPapers"
              label="Box and papers"
              defaultValue="UNKNOWN"
              options={BOX_PAPERS.map((b) => ({ value: b, label: BOX_PAPERS_LABELS[b] }))}
            />
            <TextField name="targetDate" type="date" label="Wanted by" />
            <SelectField
              name="priority"
              label="How badly"
              defaultValue="NORMAL"
              options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
            />
            <SelectField
              name="ownerId"
              label="Who is sourcing it"
              placeholder="You"
              className="sm:col-span-2"
              options={owners.map((owner) => ({ value: owner.id, label: owner.name }))}
            />
          </div>
          <TextareaField
            name="notes"
            label="Anything else"
            placeholder="Will consider a 116500 if the price is right. Not interested in a two-tone."
            maxLength={2000}
          />
        </>
      )}
    />
  )
}
