'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Button, TextField, SelectField, TextareaField, Card, CardBody, CardFooter, useToast } from '@/components/ui'
import { createWatchAction, updateWatchAction } from '@/app/actions/watches'
import type { ActionState } from '@/app/actions/auth'
import { CONDITIONS, CONDITION_LABELS, BOX_PAPERS, BOX_PAPERS_LABELS } from '@/lib/enums'
import { toMajor, parseMoneyInput, formatMoney } from '@/lib/money'
import { toDateInput } from '@/lib/dates'

export interface Option { id: string; name: string }

export interface WatchFormValues {
  id?: string
  version?: number
  brandId: string
  model: string
  nickname: string
  serial: string
  year: string
  condition: string
  boxPapers: string
  supplierId: string
  purchaseDate: string
  purchasePriceGbp: string
  estSaleUsd: string
  locationId: string
  notes: string
}

const EMPTY: WatchFormValues = {
  brandId: '', model: '', nickname: '', serial: '', year: '',
  condition: 'EXCELLENT', boxPapers: 'UNKNOWN', supplierId: '',
  purchaseDate: toDateInput(new Date()), purchasePriceGbp: '', estSaleUsd: '',
  locationId: '', notes: '',
}

const INITIAL: ActionState = { ok: false }

/**
 * Create/edit form for a watch.
 *
 * The same component serves both modes so validation, layout and copy cannot
 * drift apart. In edit mode a hidden `version` field carries the optimistic
 * concurrency token read when the form was opened.
 */
export function WatchForm({ mode, initial, brands, suppliers, locations, fxRate }: {
  mode: 'create' | 'edit'
  initial?: Partial<WatchFormValues>
  brands: Option[]
  suppliers: Option[]
  locations: Option[]
  fxRate: number
}) {
  const router = useRouter()
  const toast = useToast()
  const action = mode === 'create' ? createWatchAction : updateWatchAction
  const [state, formAction] = useFormState(action, INITIAL)
  const [values, setValues] = useState<WatchFormValues>({ ...EMPTY, ...initial })

  useEffect(() => {
    if (!state.ok) return
    toast.success(mode === 'create' ? 'Watch added to stock' : 'Changes saved', state.message)
    router.push('/inventory')
    // Only fire on a successful submission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok])

  const set = (key: keyof WatchFormValues) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => setValues((current) => ({ ...current, [key]: event.target.value }))

  // Live GBP -> USD conversion mirrors what the service will store.
  const usdPreview = useMemo(() => {
    const minor = parseMoneyInput(values.purchasePriceGbp)
    return minor === null ? null : Math.round(minor * fxRate)
  }, [values.purchasePriceGbp, fxRate])

  return (
    <form action={formAction} noValidate>
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
          <SelectField
            name="brandId" label="Brand" required
            value={values.brandId} onChange={set('brandId')}
            placeholder="Choose a brand…"
            options={brands.map((b) => ({ value: b.id, label: b.name }))}
            error={state.errors?.brandId}
          />
          <TextField
            name="model" label="Model reference" required
            value={values.model} onChange={set('model')}
            placeholder="e.g. 126711CHNR" error={state.errors?.model}
          />
          <TextField
            name="nickname" label="Nickname"
            hint="How the team refers to it, e.g. “Root Beer”."
            value={values.nickname} onChange={set('nickname')}
            error={state.errors?.nickname}
          />
          <TextField
            name="serial" label="Serial number"
            hint="Checked against existing stock to prevent duplicates."
            value={values.serial} onChange={set('serial')}
            error={state.errors?.serial}
          />
          <SelectField
            name="supplierId" label="Supplier" required
            value={values.supplierId} onChange={set('supplierId')}
            placeholder="Choose a supplier…"
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
            error={state.errors?.supplierId}
          />
          <TextField
            name="purchaseDate" label="Date of purchase" type="date" required
            value={values.purchaseDate} onChange={set('purchaseDate')}
            error={state.errors?.purchaseDate}
          />
          <TextField
            name="purchasePriceGbp" label="Purchase price (£)" required inputMode="decimal" prefix="£"
            value={values.purchasePriceGbp} onChange={set('purchasePriceGbp')}
            placeholder="13,106.00"
            hint={usdPreview !== null
              ? `≈ ${formatMoney(usdPreview, 'USD')} at today's rate (${fxRate.toFixed(2)}) — stored in both currencies`
              : `Converted to USD at ${fxRate.toFixed(2)} and stored in both currencies`}
            error={state.errors?.purchasePriceGbp}
          />
          <TextField
            name="estSaleUsd" label="Est. sale price ($)" inputMode="decimal" prefix="$"
            value={values.estSaleUsd} onChange={set('estSaleUsd')}
            placeholder="Optional — set later from pricing review"
            hint="Leave blank and the watch is flagged as needing a price."
            error={state.errors?.estSaleUsd}
          />
          <SelectField
            name="locationId" label="Location" required
            value={values.locationId} onChange={set('locationId')}
            placeholder="Choose a location…"
            options={locations.map((l) => ({ value: l.id, label: l.name }))}
            error={state.errors?.locationId}
          />
          <SelectField
            name="condition" label="Condition"
            value={values.condition} onChange={set('condition')}
            options={CONDITIONS.map((c) => ({ value: c, label: CONDITION_LABELS[c] }))}
          />
          <SelectField
            name="boxPapers" label="Box & papers"
            value={values.boxPapers} onChange={set('boxPapers')}
            options={BOX_PAPERS.map((b) => ({ value: b, label: BOX_PAPERS_LABELS[b] }))}
          />
          <TextField
            name="year" label="Year" inputMode="numeric"
            value={values.year} onChange={set('year')}
            placeholder="e.g. 2021" error={state.errors?.year}
          />
          <TextareaField
            name="notes" label="Notes" className="sm:col-span-2"
            value={values.notes} onChange={set('notes')}
            placeholder="Condition detail, links, anything worth recording"
          />
        </CardBody>

        <CardFooter>
          <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
          <SubmitButton mode={mode} />
        </CardFooter>
      </Card>
    </form>
  )
}

function SubmitButton({ mode }: { mode: 'create' | 'edit' }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending}>
      {mode === 'create' ? 'Add watch to stock' : 'Save changes'}
    </Button>
  )
}

export { toMajor }
