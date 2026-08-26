'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Button, TextField, SelectField, TextareaField, Card, CardBody, CardFooter, ComboSelect, MoneyField, useToast } from '@/components/ui'
import { createWatchAction, updateWatchAction } from '@/app/actions/watches'
import { createBrandAction, createSupplierInlineAction } from '@/app/actions/reference'
import { ChevronDown } from 'lucide-react'
import type { ActionState } from '@/app/actions/auth'
import {
  accessoriesLabel, BASE_CURRENCY, CONDITIONS, CONDITION_LABELS, BOX_PAPERS, BOX_PAPERS_LABELS,
  DEFAULT_PRODUCT_TYPE, PRODUCT_TYPES, PRODUCT_TYPE_LABELS, PRODUCT_TYPE_NOUNS, referenceLabel,
  type CurrencyCode, type ProductType,
} from '@/lib/enums'
import { toMajor } from '@/lib/money'
import { toDateInput } from '@/lib/dates'

export interface Option { id: string; name: string }

export interface WatchFormValues {
  id?: string
  version?: number
  productType: ProductType
  brandId: string
  model: string
  serial: string
  year: string
  condition: string
  boxPapers: string
  supplierId: string
  purchaseDate: string
  purchaseAmount: string
  purchaseCurrency: CurrencyCode
  estSaleAmount: string
  estSaleCurrency: CurrencyCode
  locationId: string
  notes: string
}

const EMPTY: WatchFormValues = {
  productType: DEFAULT_PRODUCT_TYPE,
  brandId: '', model: '', serial: '', year: '',
  condition: 'UNKNOWN', boxPapers: 'UNKNOWN', supplierId: '',
  purchaseDate: toDateInput(new Date()),
  purchaseAmount: '', purchaseCurrency: BASE_CURRENCY,
  estSaleAmount: '', estSaleCurrency: BASE_CURRENCY,
  locationId: '', notes: '',
}

/**
 * The reference field, named for what is being added.
 *
 * A watch has a manufacturer's reference and everybody quotes it; a handbag
 * has a model name. The field is the same one — the thing you would say to
 * identify the piece — so it stays one field and changes what it asks for.
 */
const REFERENCE_COPY: Record<ProductType, { hint: string; placeholder: string }> = {
  WATCH: {
    hint: 'The manufacturer’s reference, e.g. 126711CHNR.',
    placeholder: '126711CHNR',
  },
  JEWELLERY: {
    hint: 'What the piece is called, or its reference if it has one.',
    placeholder: 'Love bracelet, 18ct',
  },
  HANDBAG: {
    hint: 'The model and size, as the maker names it.',
    placeholder: 'Birkin 30',
  },
  ACCESSORY: {
    hint: 'What the item is, in the words you would use to ask for it.',
    placeholder: 'Cufflinks, onyx',
  },
  OTHER: {
    hint: 'What the item is, in the words you would use to ask for it.',
    placeholder: 'Describe the item',
  },
}

const INITIAL: ActionState = { ok: false }

/**
 * Create/edit form for a watch.
 *
 * The same component serves both modes so validation, layout and copy cannot
 * drift apart. In edit mode a hidden `version` field carries the optimistic
 * concurrency token read when the form was opened.
 */
export function WatchForm({ mode, initial, brands, suppliers, locations, requestId }: {
  mode: 'create' | 'edit'
  initial?: Partial<WatchFormValues>
  /** Set when intake is fulfilling a want: the action settles the request. */
  requestId?: string
  brands: Option[]
  suppliers: Option[]
  locations: Option[]
}) {
  const router = useRouter()
  const toast = useToast()
  const action = mode === 'create' ? createWatchAction : updateWatchAction
  const [state, formAction] = useFormState(action, INITIAL)
  const [values, setValues] = useState<WatchFormValues>({ ...EMPTY, ...initial })
  // Opened automatically when editing a record that already has these set.
  const [showOptional, setShowOptional] = useState(
    Boolean(initial && (
      (initial.condition && initial.condition !== 'UNKNOWN') ||
      (initial.boxPapers && initial.boxPapers !== 'UNKNOWN') ||
      initial.year
    )),
  )

  useEffect(() => {
    if (!state.ok) return
    toast.success(
      mode === 'create'
        ? `${noun.charAt(0).toUpperCase()}${noun.slice(1)} added to stock`
        : 'Changes saved',
      state.message,
    )
    router.push('/inventory')
    // Only fire on a successful submission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok])

  const noun = PRODUCT_TYPE_NOUNS[values.productType]
  const reference = REFERENCE_COPY[values.productType]

  const set = (key: keyof WatchFormValues) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => setValues((current) => ({ ...current, [key]: event.target.value }))

  const setField = (key: keyof WatchFormValues) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }))

  return (
    <form action={formAction} noValidate>
      {requestId && <input type="hidden" name="requestId" value={requestId} />}
      {mode === 'edit' && (
        <>
          <input type="hidden" name="id" value={values.id ?? ''} />
          <input type="hidden" name="version" value={values.version ?? 1} />
        </>
      )}

      {state.message && !state.ok && (
        <div role="alert" className="mb-6 flex items-start gap-2 rounded-md border border-state-danger/30 bg-state-danger/8 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-state-danger" aria-hidden />
          <p className="text-small text-state-danger">{state.message}</p>
        </div>
      )}

      <Card>
        <CardBody className="grid gap-5 sm:grid-cols-2">
          {/* First, because it changes what the rest of the form asks for —
              and pre-set to Watch, because that is what nearly every intake
              is. Somebody adding a watch never has to touch it. */}
          <SelectField
            name="productType" label="Product type" className="sm:col-span-2"
            hint="Watch unless you change it — for the occasional piece of jewellery or handbag."
            value={values.productType}
            onChange={(event) => setValues((c) => ({ ...c, productType: event.target.value as ProductType }))}
            options={PRODUCT_TYPES.map((type) => ({ value: type, label: PRODUCT_TYPE_LABELS[type] }))}
            error={state.errors?.productType}
          />
          <ComboSelect
            name="brandId" label="Brand" required
            value={values.brandId}
            onChange={(v) => setValues((c) => ({ ...c, brandId: v }))}
            placeholder="Choose a brand…"
            options={brands.map((b) => ({ value: b.id, label: b.name }))}
            onCreate={async (label) => {
              const result = await createBrandAction(label)
              if (!result.ok || !result.id) { toast.error('Could not add brand', result.message); return null }
              if (result.message) toast.success(result.message)
              return { value: result.id, label: result.name ?? label }
            }}
            createLabel="Add brand"
            error={state.errors?.brandId}
          />
          <TextField
            name="model" label={referenceLabel(values.productType)} required
            value={values.model} onChange={set('model')}
            hint={reference.hint}
            placeholder={reference.placeholder} error={state.errors?.model}
          />
          <TextField
            name="serial" label="Serial number"
            hint="Checked against existing stock to prevent duplicates."
            value={values.serial} onChange={set('serial')}
            error={state.errors?.serial}
          />
          <ComboSelect
            name="supplierId" label="Supplier" required
            value={values.supplierId}
            onChange={(v) => setValues((c) => ({ ...c, supplierId: v }))}
            placeholder="Choose a supplier…"
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
            onCreate={async (label) => {
              const result = await createSupplierInlineAction(label)
              if (!result.ok || !result.id) { toast.error('Could not add supplier', result.message); return null }
              if (result.message) toast.success(result.message)
              return { value: result.id, label: result.name ?? label }
            }}
            createLabel="Add supplier"
            error={state.errors?.supplierId}
          />
          <TextField
            name="purchaseDate" label="Date of purchase" type="date" required
            value={values.purchaseDate} onChange={set('purchaseDate')}
            error={state.errors?.purchaseDate}
          />
          <MoneyField
            label="Purchase price"
            required
            amountName="purchaseAmount"
            currencyName="purchaseCurrency"
            amount={values.purchaseAmount}
            currency={values.purchaseCurrency}
            onAmountChange={setField('purchaseAmount')}
            onCurrencyChange={(code: CurrencyCode) => setValues((c) => ({ ...c, purchaseCurrency: code }))}
            hint="The amount you actually agreed with the supplier."
            error={state.errors?.purchaseAmount}
          />
          <MoneyField
            label="Est. sale price"
            amountName="estSaleAmount"
            currencyName="estSaleCurrency"
            amount={values.estSaleAmount}
            currency={values.estSaleCurrency}
            onAmountChange={setField('estSaleAmount')}
            onCurrencyChange={(code: CurrencyCode) => setValues((c) => ({ ...c, estSaleCurrency: code }))}
            hint="Leave blank and the watch is flagged as needing a price."
            error={state.errors?.estSaleAmount}
          />
          <SelectField
            name="locationId" label="Location" required
            value={values.locationId} onChange={set('locationId')}
            placeholder="Choose a location…"
            options={locations.map((l) => ({ value: l.id, label: l.name }))}
            error={state.errors?.locationId}
          />
          <TextareaField
            name="notes" label="Notes" className="sm:col-span-2"
            value={values.notes} onChange={set('notes')}
            placeholder="Condition detail, links, anything worth recording"
          />
        </CardBody>

        {/* Everything below is optional and can be filled in later from the
            watch record. Collapsed by default so the required path is short. */}
        <div className="border-t border-line-subtle">
          <button
            type="button"
            onClick={() => setShowOptional((v) => !v)}
            aria-expanded={showOptional}
            className="flex w-full items-center justify-between px-6 py-4 text-left"
          >
            <span>
              <span className="block text-body font-bold text-content-primary">Additional details</span>
              <span className="block text-caption text-content-secondary">
                Condition, {accessoriesLabel(values.productType).toLowerCase().replace('&', 'and')} and year — all optional, and editable later.
              </span>
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-content-secondary transition-transform ${showOptional ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </button>

          {showOptional && (
            <div className="grid gap-5 px-6 pb-6 sm:grid-cols-2">
              <SelectField
                name="condition" label="Condition"
                hint="Leave as “Not recorded” if you have not assessed it yet."
                value={values.condition} onChange={set('condition')}
                options={CONDITIONS.map((c) => ({ value: c, label: CONDITION_LABELS[c] }))}
              />
              <SelectField
                name="boxPapers" label={accessoriesLabel(values.productType)}
                value={values.boxPapers} onChange={set('boxPapers')}
                options={BOX_PAPERS.map((b) => ({ value: b, label: BOX_PAPERS_LABELS[b] }))}
              />
              <TextField
                name="year" label="Year" inputMode="numeric"
                value={values.year} onChange={set('year')}
                placeholder="e.g. 2021" error={state.errors?.year}
              />
            </div>
          )}
        </div>
        <CardFooter>
          <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
          <SubmitButton mode={mode} noun={noun} />
        </CardFooter>
      </Card>
    </form>
  )
}

function SubmitButton({ mode, noun }: { mode: 'create' | 'edit'; noun: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending}>
      {mode === 'create' ? `Add ${noun} to stock` : 'Save changes'}
    </Button>
  )
}

export { toMajor }
