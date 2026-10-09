'use client'
import { useEffect, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { SelectField, TextField, useToast } from '@/components/ui'
import { createBrandAction } from '@/app/actions/reference'

export interface BrandOption { id: string; name: string }

/** The value the select carries while somebody is naming a maison by hand. */
const OTHER = '__other__'

/**
 * Which maison a piece is, chosen from the list.
 *
 * This was a combo box that created a brand from whatever was typed into it,
 * and the list it produced is the argument against it: "Patek" above "Patek
 * Philippe", a bare "Vacheron" beside the full name, an Omega nobody deals
 * in. Each of those is a maison split in two everywhere it is counted — the
 * storefront groups by brand, the catalogue filters on it, customer interest
 * is keyed on it — and every one arrived as a typo nobody noticed, because
 * typing and choosing looked identical.
 *
 * So the two are separated. The list is a list: open it, pick one, and there
 * is no way to make a new maison by mistyping an old one. Adding a real one
 * is still possible and still takes seconds, but it is now a thing you say
 * you are doing — choose "Other", type the name, press Add — rather than
 * something that happens to you.
 *
 * The id goes to the form in a hidden input rather than on the select, because
 * the select's value is sometimes OTHER, which is not a brand.
 */
export function BrandField({ options, value, onChange, error }: {
  options: BrandOption[]
  value: string
  onChange: (id: string) => void
  error?: string
}) {
  const toast = useToast()
  const [brands, setBrands] = useState(options)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => setBrands(options), [options])

  const add = async () => {
    const label = name.trim()
    if (!label || adding) return
    setAdding(true)
    const result = await createBrandAction(label)
    setAdding(false)
    if (!result.ok || !result.id) {
      toast.error('Could not add brand', result.message)
      return
    }
    // It may already have existed under another spelling — the action says so,
    // and the answer is the row that was there, which is the right outcome.
    const added = { id: result.id, name: result.name ?? label }
    setBrands((list) => (list.some((b) => b.id === added.id) ? list : [...list, added])
      .sort((a, b) => a.name.localeCompare(b.name)))
    onChange(added.id)
    setNaming(false)
    setName('')
    if (result.message) toast.success(result.message)
  }

  return (
    <div className="flex flex-col gap-2">
      <SelectField
        label="Brand"
        required
        value={naming ? OTHER : value}
        onChange={(event) => {
          const next = event.target.value
          setNaming(next === OTHER)
          // Clearing the id while a name is being typed is deliberate: the
          // form should not submit the maison that happened to be chosen
          // before somebody decided it was a different one.
          onChange(next === OTHER ? '' : next)
        }}
        placeholder="Choose a brand…"
        options={[
          ...brands.map((b) => ({ value: b.id, label: b.name })),
          { value: OTHER, label: 'Other…' },
        ]}
        error={error}
      />
      <input type="hidden" name="brandId" value={value} />

      {naming && (
        <div className="flex items-end gap-2">
          <TextField
            label="Brand name"
            className="flex-1"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              // Enter adds the brand rather than submitting the whole form,
              // which at this point is half filled in.
              if (event.key === 'Enter') { event.preventDefault(); void add() }
            }}
            placeholder="e.g. Jaeger-LeCoultre"
            hint="Added to the list for everyone, so check the spelling."
            autoFocus
          />
          <button
            type="button"
            onClick={add}
            disabled={!name.trim() || adding}
            className="mb-[1px] inline-flex h-10 items-center gap-1.5 rounded-md bg-content-primary px-3.5 text-caption font-semibold text-surface-raised transition-opacity disabled:opacity-40"
          >
            {adding
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              : <Plus className="h-3.5 w-3.5" aria-hidden />}
            Add
          </button>
        </div>
      )}
    </div>
  )
}
