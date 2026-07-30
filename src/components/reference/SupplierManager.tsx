'use client'
import { Fragment, useMemo, useState } from 'react'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { Building2, ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  Card, Table, THead, TBody, TR, TD, TH, Button, Modal, TextField, SelectField,
  TextareaField, Checkbox, Chip, ConfirmDialog, EmptyState, useToast, useCurrency, useCreateFlag,
  ToolbarRow, ToolbarSearch, ToolbarSelect,
} from '@/components/ui'
import { saveSupplierAction, deleteSupplierAction } from '@/app/actions/reference'
import type { ActionState } from '@/app/actions/auth'
import {
  CURRENCIES, ENTITY_TYPES, ENTITY_TYPE_LABELS, PAYMENT_TERMS, PAYMENT_TERMS_LABELS,
  type EntityType, type PaymentTerms,
} from '@/lib/enums'
import { cn } from '@/lib/cn'

export interface SupplierRow {
  id: string
  name: string
  legalName: string | null
  entityType: EntityType
  registrationNo: string | null
  vatNo: string | null
  website: string | null
  contactName: string | null
  contactRole: string | null
  contactEmail: string | null
  contactPhone: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  postcode: string | null
  country: string | null
  paymentTerms: PaymentTerms
  defaultCurrency: string
  notes: string | null
  isActive: boolean
  watchCount: number
  totalCostGbp: number
  inStockCount: number
  soldCount: number
}

const INITIAL: ActionState = { ok: false }

/**
 * How complete a supplier's paperwork is.
 *
 * Surfaced as a count rather than a validation error: a supplier can be created
 * from the watch form with nothing but a name, which is the right trade-off
 * when a watch is in front of you and the invoice is not. What is wrong is
 * letting that gap stay invisible until somebody needs to pay them.
 */
const REQUIRED_FOR_TRADING = [
  { key: 'legalName', label: 'Legal entity name' },
  { key: 'entityType', label: 'Entity type' },
  { key: 'contactName', label: 'Named representative' },
  { key: 'contactEmail', label: 'Contact email' },
  { key: 'country', label: 'Country' },
  { key: 'paymentTerms', label: 'Payment terms' },
] as const

function missingFields(supplier: SupplierRow): string[] {
  return REQUIRED_FOR_TRADING.filter((field) => {
    const value = supplier[field.key as keyof SupplierRow]
    return value === null || value === '' || value === 'UNKNOWN'
  }).map((field) => field.label)
}

/**
 * Supplier list with inline create and edit.
 *
 * Suppliers are a short list maintained rarely, so a modal over the table beats
 * dedicated routes — the user never loses sight of the list. The row expands to
 * show the trading detail rather than opening the form to read it.
 */
export function SupplierManager({ suppliers, canManage }: { suppliers: SupplierRow[]; canManage: boolean }) {
  const toast = useToast()
  const { money } = useCurrency()
  const [editing, setEditing] = useState<SupplierRow | null>(null)
  // Opening state lives in the URL so the header button, the empty state
  // and a deep link all reach the same form.
  const create = useCreateFlag()
  const [deleting, setDeleting] = useState<SupplierRow | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [search, setSearch] = useState('')
  const [view, setView] = useState<'all' | 'incomplete' | 'inactive'>('all')

  const incomplete = suppliers.filter((s) => s.isActive && missingFields(s).length > 0).length

  /**
   * Filtered in the browser, not on the server: the whole list is already here
   * because the totals in the header are computed across all of it, and a
   * supplier list is tens of rows rather than thousands. Searching the
   * representative and the legal name too — you are as likely to remember the
   * person you deal with as the trading name on the invoice.
   */
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return suppliers.filter((supplier) => {
      if (view === 'incomplete' && (!supplier.isActive || missingFields(supplier).length === 0)) return false
      if (view === 'inactive' && supplier.isActive) return false
      if (!needle) return true
      return [
        supplier.name, supplier.legalName, supplier.contactName,
        supplier.contactEmail, supplier.city, supplier.country,
      ].some((field) => field?.toLowerCase().includes(needle))
    })
  }, [suppliers, search, view])

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    const result = await deleteSupplierAction(deleting.id)
    setBusy(false)
    setDeleting(null)
    if (result.ok) toast.success('Supplier deleted')
    else toast.error('Could not delete supplier', result.message)
  }

  return (
    <>
      {incomplete > 0 && (
        <p className="mb-4 text-small text-content-secondary">
          <span className="font-bold text-state-gold">{incomplete}</span> of {suppliers.length} suppliers
          are missing details you would need to raise a purchase order or pay an invoice.
        </p>
      )}

      {suppliers.length > 0 && (
        <ToolbarRow className="mb-4">
          <ToolbarSearch
            value={search}
            onChange={setSearch}
            label="Search suppliers"
            placeholder="Search by name, representative, email or country…"
          />
          <ToolbarSelect
            label="Show"
            value={view}
            onChange={(value) => setView(value as typeof view)}
            options={[
              { value: 'all', label: 'All suppliers' },
              { value: 'incomplete', label: 'Missing details' },
              { value: 'inactive', label: 'Inactive' },
            ]}
          />
        </ToolbarRow>
      )}

      <Card className="overflow-hidden">
        {suppliers.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title="No suppliers yet"
            description="Add the dealers, auction houses and private sellers you buy from so purchases can be attributed."
            action={canManage ? <Button onClick={() => create.openIt()}>Add supplier</Button> : undefined}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH width="44px"><span className="sr-only">Expand</span></TH>
                <TH>Supplier</TH>
                <TH width="150px">Representative</TH>
                <TH width="150px">Terms</TH>
                <TH width="100px" align="right">Purchased</TH>
                <TH width="100px" align="right">In stock</TH>
                <TH width="130px" align="right">Total spend</TH>
                <TH width="120px">Status</TH>
                {canManage && <TH width="96px" align="right"><span className="sr-only">Actions</span></TH>}
              </TR>
            </THead>
            <TBody>
              {visible.length === 0 && (
                <TR>
                  <TD colSpan={canManage ? 9 : 8} className="py-10 text-center text-content-secondary">
                    No supplier matches that. <button type="button" onClick={() => { setSearch(''); setView('all') }} className="font-bold text-content-accent hover:underline">Clear the filters</button>
                  </TD>
                </TR>
              )}
              {visible.map((supplier) => {
                const gaps = missingFields(supplier)
                const isOpen = expanded === supplier.id
                return (
                  <Fragment key={supplier.id}>
                    <TR>
                      <TD>
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : supplier.id)}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? 'Hide' : 'Show'} details for ${supplier.name}`}
                          className="rounded-sm p-1 text-content-secondary transition-colors hover:bg-surface-subtle hover:text-content-primary"
                        >
                          <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} aria-hidden />
                        </button>
                      </TD>
                      <TD>
                        <span className="block truncate font-bold text-content-primary">{supplier.name}</span>
                        {/* One line: "Journey Trading Ltd · Limited" then
                            "company" underneath read as a second supplier. */}
                        <span className="block truncate text-caption text-content-secondary" title={supplier.legalName ?? undefined}>
                          {[
                            supplier.legalName && supplier.legalName !== supplier.name ? supplier.legalName : null,
                            supplier.entityType !== 'UNKNOWN' ? ENTITY_TYPE_LABELS[supplier.entityType] : null,
                            supplier.country,
                          ].filter(Boolean).join(' · ') || 'No trading details recorded'}
                        </span>
                      </TD>
                      <TD className="text-content-secondary">
                        {supplier.contactName ?? '—'}
                        {supplier.contactRole && (
                          <span className="block text-caption">{supplier.contactRole}</span>
                        )}
                      </TD>
                      <TD className="text-content-secondary">
                        {supplier.paymentTerms === 'UNKNOWN'
                          ? '—'
                          : `${PAYMENT_TERMS_LABELS[supplier.paymentTerms]} · ${supplier.defaultCurrency}`}
                      </TD>
                      <TD align="right">
                        <Link href={`/inventory?supplierId=${supplier.id}`} className="font-bold text-navy-700 hover:underline">
                          {supplier.watchCount}
                        </Link>
                      </TD>
                      <TD align="right" className="text-content-secondary">{supplier.inStockCount}</TD>
                      <TD align="right" className="font-bold">{money(supplier.totalCostGbp)}</TD>
                      <TD>
                        <div className="flex flex-wrap items-center gap-1">
                          <Chip tone={supplier.isActive ? 'accent' : 'neutral'} dot={supplier.isActive}>
                            {supplier.isActive ? 'Active' : 'Inactive'}
                          </Chip>
                          {gaps.length > 0 && supplier.isActive && (
                            <Chip tone="gold">{gaps.length} to fill</Chip>
                          )}
                        </div>
                      </TD>
                      {canManage && (
                        <TD>
                          <div className="flex items-center justify-end gap-1">
                            <button type="button" onClick={() => setEditing(supplier)} aria-label={`Edit ${supplier.name}`}
                              className="flex h-8 w-8 items-center justify-center rounded-sm text-content-secondary hover:bg-surface-subtle hover:text-content-primary">
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button type="button" onClick={() => setDeleting(supplier)} aria-label={`Delete ${supplier.name}`}
                              className="flex h-8 w-8 items-center justify-center rounded-sm text-content-secondary hover:bg-state-danger/10 hover:text-state-danger">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </TD>
                      )}
                    </TR>

                    {isOpen && (
                      <TR className="bg-surface-subtle">
                        <TD colSpan={canManage ? 9 : 8}>
                          <SupplierDetail supplier={supplier} gaps={gaps} onEdit={canManage ? () => setEditing(supplier) : undefined} />
                        </TD>
                      </TR>
                    )}
                  </Fragment>
                )
              })}
            </TBody>
          </Table>
        )}
      </Card>

      <SupplierFormModal
        open={create.open || editing !== null}
        supplier={editing}
        onClose={() => { create.close(); setEditing(null) }}
        onSaved={(message) => { toast.success(message); create.close(); setEditing(null) }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={busy}
        title={`Delete ${deleting?.name}?`}
        message={
          deleting && deleting.watchCount > 0
            ? `${deleting.name} has ${deleting.watchCount} watches against it, so it cannot be deleted. Deactivate it instead to hide it from new purchases.`
            : 'The supplier will be removed from the list. Past purchases keep their history.'
        }
        confirmLabel="Delete supplier"
      />
    </>
  )
}

/** The trading detail, shown in place rather than by opening the edit form to read it. */
function SupplierDetail({ supplier, gaps, onEdit }: {
  supplier: SupplierRow
  gaps: string[]
  onEdit?: () => void
}) {
  const address = [supplier.addressLine1, supplier.addressLine2, supplier.city, supplier.postcode, supplier.country]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="grid gap-6 py-2 lg:grid-cols-3">
      <Facts title="Entity" items={[
        ['Trading name', supplier.name],
        ['Legal entity', supplier.legalName],
        ['Type', supplier.entityType === 'UNKNOWN' ? null : ENTITY_TYPE_LABELS[supplier.entityType]],
        ['Registration no.', supplier.registrationNo],
        ['VAT no.', supplier.vatNo],
        ['Website', supplier.website],
      ]} />

      <Facts title="Representative" items={[
        ['Name', supplier.contactName],
        ['Role', supplier.contactRole],
        ['Email', supplier.contactEmail],
        ['Phone', supplier.contactPhone],
        ['Address', address || null],
      ]} />

      <div className="flex flex-col gap-3">
        <Facts title="Commercial" items={[
          ['Payment terms', supplier.paymentTerms === 'UNKNOWN' ? null : PAYMENT_TERMS_LABELS[supplier.paymentTerms]],
          ['Invoices in', supplier.defaultCurrency],
          ['Sold on', `${supplier.soldCount} of ${supplier.watchCount}`],
        ]} />

        {gaps.length > 0 && (
          <div className="rounded-md border border-state-gold/40 bg-state-gold/8 p-3">
            <p className="text-caption font-semibold text-content-primary">Still to record</p>
            <p className="mt-1 text-caption text-content-secondary">{gaps.join(', ')}.</p>
            {onEdit && (
              <button type="button" onClick={onEdit} className="mt-2 text-caption font-bold text-content-accent hover:underline">
                Fill these in
              </button>
            )}
          </div>
        )}

        {supplier.notes && (
          <div>
            <p className="text-caption font-semibold text-content-secondary">Notes</p>
            <p className="mt-1 whitespace-pre-line text-small text-content-primary">{supplier.notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function Facts({ title, items }: { title: string; items: Array<[string, string | null]> }) {
  return (
    <div>
      <p className="mb-2 text-caption font-semibold text-content-secondary">{title}</p>
      <dl className="flex flex-col gap-1.5">
        {items.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4">
            <dt className="shrink-0 text-caption text-content-secondary">{label}</dt>
            <dd className={cn('min-w-0 truncate text-right text-small', value ? 'text-content-primary' : 'text-content-secondary')}>
              {value ?? 'Not recorded'}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function SupplierFormModal({ open, supplier, onClose, onSaved }: {
  open: boolean
  supplier: SupplierRow | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [state, action] = useFormState(saveSupplierAction, INITIAL)
  const [wasOpen, setWasOpen] = useState(false)

  // Fire the success callback exactly once per successful submit.
  if (state.ok && open && !wasOpen) {
    setWasOpen(true)
    onSaved(state.message ?? 'Saved')
  }
  if (!open && wasOpen) setWasOpen(false)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={supplier ? `Edit ${supplier.name}` : 'Add a supplier'}
      description="Only the trading name is required — the rest can be filled in when the paperwork arrives."
      size="lg"
      footer={<SupplierFooter onClose={onClose} isEdit={Boolean(supplier)} formId="supplier-form" />}
    >
      <form id="supplier-form" action={action} className="flex flex-col gap-6" noValidate>
        {supplier && <input type="hidden" name="id" value={supplier.id} />}

        <Section title="Who they are" hint="The name on the invoice often differs from the one you use day to day.">
          <TextField name="name" label="Trading name" required defaultValue={supplier?.name ?? ''}
            hint="What the team calls them." className="sm:col-span-2" error={state.errors?.name} />
          <TextField name="legalName" label="Legal entity name" defaultValue={supplier?.legalName ?? ''}
            placeholder="e.g. GB Luxury Trading Limited" className="sm:col-span-2" />
          <SelectField name="entityType" label="Entity type" defaultValue={supplier?.entityType ?? 'UNKNOWN'}
            options={ENTITY_TYPES.map((t) => ({ value: t, label: ENTITY_TYPE_LABELS[t] }))} />
          <TextField name="registrationNo" label="Company registration no." defaultValue={supplier?.registrationNo ?? ''}
            hint="Companies House, or the local equivalent." />
          <TextField name="vatNo" label="VAT / tax number" defaultValue={supplier?.vatNo ?? ''} />
          <TextField name="website" label="Website" defaultValue={supplier?.website ?? ''} placeholder="Optional" />
        </Section>

        <Section title="Who you deal with" hint="The named individual, not a general inbox — it is who you chase.">
          <TextField name="contactName" label="Representative" defaultValue={supplier?.contactName ?? ''} />
          <TextField name="contactRole" label="Their role" defaultValue={supplier?.contactRole ?? ''}
            placeholder="e.g. Sales director" />
          <TextField name="contactEmail" label="Email" type="email" defaultValue={supplier?.contactEmail ?? ''}
            error={state.errors?.contactEmail} />
          <TextField name="contactPhone" label="Phone" defaultValue={supplier?.contactPhone ?? ''} />
        </Section>

        <Section title="Where they are">
          <TextField name="addressLine1" label="Address" defaultValue={supplier?.addressLine1 ?? ''} className="sm:col-span-2" />
          <TextField name="addressLine2" label="Address line 2" defaultValue={supplier?.addressLine2 ?? ''} className="sm:col-span-2" />
          <TextField name="city" label="City" defaultValue={supplier?.city ?? ''} />
          <TextField name="postcode" label="Postcode" defaultValue={supplier?.postcode ?? ''} />
          <TextField name="country" label="Country" defaultValue={supplier?.country ?? ''} className="sm:col-span-2" />
        </Section>

        <Section title="How you trade" hint="Drives what you owe them and when.">
          <SelectField name="paymentTerms" label="Payment terms" defaultValue={supplier?.paymentTerms ?? 'UNKNOWN'}
            options={PAYMENT_TERMS.map((t) => ({ value: t, label: PAYMENT_TERMS_LABELS[t] }))} />
          <SelectField name="defaultCurrency" label="Invoices in" defaultValue={supplier?.defaultCurrency ?? 'GBP'}
            hint="Pre-selected when booking in stock from them."
            options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          <TextareaField name="notes" label="Notes" className="sm:col-span-2" defaultValue={supplier?.notes ?? ''}
            placeholder="Lead times, authentication habits, anything worth remembering" />
          <div className="sm:col-span-2">
            <Checkbox name="isActive" label="Active"
              hint="Inactive suppliers stay on past purchases but cannot be chosen for new stock."
              defaultChecked={supplier?.isActive ?? true} />
          </div>
        </Section>
      </form>
    </Modal>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-small font-bold text-content-primary">{title}</legend>
      {hint && <p className="mt-0.5 text-caption text-content-secondary">{hint}</p>}
      <div className="mt-3 grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}

function SupplierFooter({ onClose, isEdit, formId }: { onClose: () => void; isEdit: boolean; formId: string }) {
  const { pending } = useFormStatus()
  return (
    <>
      <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
      <Button type="submit" form={formId} loading={pending}>{isEdit ? 'Save changes' : 'Add supplier'}</Button>
    </>
  )
}
