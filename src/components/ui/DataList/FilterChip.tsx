'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { AnchoredMenu } from '../AnchoredMenu'
import { useCurrency } from '../CurrencyProvider'
import { cn } from '@/lib/cn'
import { fromBase, toBase } from '@/lib/currency'
import { CURRENCY_SYMBOLS } from '@/lib/enums'
import {
  describeClause, operatorsFor, OPERATOR_LABELS, validateClause,
  type FieldSpec, type FilterClause, type FilterOperator,
} from '@/lib/filters'

/** Operators that take no value at all; everything else needs one. */
const VALUELESS = new Set<FilterOperator>(['isEmpty', 'isNotEmpty'])

/**
 * One filter, as a chip you can edit in place.
 *
 * The alternative — a modal filter builder — is what every enterprise product
 * does and what nobody uses twice. A chip says what it filters in words, opens
 * its own value list on click, and removes itself with one more. Nothing about
 * it requires reading a form.
 *
 * The operator is a second, smaller menu rather than a third dropdown in a
 * row: most filters never change operator, and putting "is / is not" in front
 * of the values makes the common case cost an extra decision.
 *
 * Until now only fields with a list of choices could be edited — so Cost,
 * Retail, Year, Case size and Bought were offered by the menu and then did
 * nothing whatsoever when chosen, because there was nowhere to put a number.
 * Seven of eighteen entries were dead buttons. A field with no choices now
 * opens a single input instead of a list, which is all any of them ever
 * needed.
 */
export function FilterChip({ clause, field, options, draft = false, onChange, onRemove }: {
  clause: FilterClause
  field: FieldSpec
  /** Reference options resolved by the page — brands, locations, people. */
  options?: ReadonlyArray<{ value: string; label: string }>
  /**
   * A filter being composed, not one that is applied.
   *
   * A number filter cannot be seeded the way an enum can: there is no sensible
   * first value, and writing "Cost is over 0" into the URL so it can be
   * corrected puts a filter nobody asked for in front of the list and in
   * anything saved from it. So the chip exists locally, with its editor
   * already open, until there is a number in it.
   */
  draft?: boolean
  onChange: (next: FilterClause) => void
  onRemove: () => void
}) {
  const valueTrigger = useRef<HTMLButtonElement>(null)
  const operatorTrigger = useRef<HTMLButtonElement>(null)
  const [valuesOpen, setValuesOpen] = useState(false)
  const [operatorsOpen, setOperatorsOpen] = useState(false)
  const [typing, setTyping] = useState(draft)

  const choices = field.options ?? options ?? []
  const operators = operatorsFor(field)
  const { currency, rates } = useCurrency()

  /**
   * A stored amount, read in the currency on screen.
   *
   * Clause values for money are major units of the stored currency, and the
   * chip used to print them behind a hard-coded pound sign — over figures that
   * have been dollars since 0018. So "Retail is under £7,000" described a
   * filter on seven thousand dollars, which is a price label telling a lie.
   */
  const showMoney = (value: string): string => {
    const stored = Number(value)
    if (!Number.isFinite(stored)) return value
    const shown = fromBase(Math.round(stored * 100), currency, rates) / 100
    return `${CURRENCY_SYMBOLS[currency]}${shown.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`
  }

  const resolve = (_key: string, value: string) =>
    choices.find((choice) => choice.value === value)?.label
      ?? (field.type === 'money' ? showMoney(value) : undefined)

  const toggleValue = (value: string) => {
    const next = clause.values.includes(value)
      ? clause.values.filter((item) => item !== value)
      : [...clause.values, value]
    // A chip with nothing selected filters nothing and reads as a mistake, so
    // clearing the last value removes the chip instead of leaving an empty one.
    if (next.length === 0) { onRemove(); return }
    const validated = validateClause({ ...clause, values: next }, [field])
    if (validated) onChange(validated)
  }

  const setOperator = (operator: FilterOperator) => {
    setOperatorsOpen(false)
    const validated = validateClause({ ...clause, operator }, [field])
    // Switching from "is" to "is empty" throws the values away, which is
    // correct — and switching back has to leave the chip in a state that still
    // means something, so a failed validation removes it rather than freezing.
    if (validated) onChange(validated)
    else onRemove()
  }

  const commit = (value: string) => {
    setTyping(false)
    if (!value.trim()) { onRemove(); return }
    const validated = validateClause({ ...clause, values: [value] }, [field])
    if (validated) onChange(validated)
    else onRemove()
  }

  const listed = choices.length > 0 && (clause.operator === 'is' || clause.operator === 'isNot')
  const typed = !listed && !VALUELESS.has(clause.operator)
  const editable = listed || typed

  const described = describeClause(clause, [field], resolve)
    .replace(`${field.label} ${OPERATOR_LABELS[clause.operator]} `, '')

  return (
    <span className={cn(
      'relative inline-flex items-center rounded-sm border bg-surface-raised text-caption',
      draft ? 'border-content-primary' : 'border-line-subtle',
    )}>
      <button
        ref={operatorTrigger}
        type="button"
        onClick={() => setOperatorsOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={operatorsOpen}
        aria-label={`Change how ${field.label} is compared`}
        className="rounded-l-pill py-1.5 pl-3 pr-1 font-semibold text-content-secondary hover:text-content-primary"
      >
        {field.label} <span className="font-normal">{OPERATOR_LABELS[clause.operator]}</span>
      </button>

      <button
        ref={valueTrigger}
        type="button"
        onClick={() => {
          if (listed) setValuesOpen((value) => !value)
          else if (typed) setTyping((value) => !value)
        }}
        aria-haspopup={editable ? (listed ? 'menu' : 'dialog') : undefined}
        aria-expanded={listed ? valuesOpen : typed ? typing : undefined}
        className={cn(
          'py-1.5 pr-1 font-semibold text-content-primary',
          editable && 'hover:text-content-accent',
        )}
      >
        {described || (typed ? 'any' : '—')}
        {editable && <ChevronDown className="ml-1 inline h-3 w-3" aria-hidden />}
      </button>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove the ${field.label} filter`}
        className="rounded-r-pill py-1.5 pl-1 pr-2.5 text-content-secondary transition-colors hover:text-state-danger"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>

      {typed && typing && (
        <ValueEditor
          field={field}
          value={clause.values[0] ?? ''}
          currency={currency}
          rates={rates}
          onCancel={() => { setTyping(false); if (draft) onRemove() }}
          onCommit={commit}
        />
      )}

      <AnchoredMenu
        open={operatorsOpen}
        onClose={() => setOperatorsOpen(false)}
        anchorRef={operatorTrigger}
        label={`${field.label} comparison`}
        items={operators.map((operator) => ({
          id: operator,
          label: OPERATOR_LABELS[operator],
          icon: operator === clause.operator ? <Check className="h-4 w-4" aria-hidden /> : undefined,
          onSelect: () => setOperator(operator),
        }))}
      />

      <AnchoredMenu
        open={valuesOpen}
        onClose={() => setValuesOpen(false)}
        anchorRef={valueTrigger}
        label={`${field.label} values`}
        dismiss="stay-open"

        items={choices.map((choice) => ({
          id: choice.value,
          label: choice.label,
          icon: clause.values.includes(choice.value)
            ? <Check className="h-4 w-4" aria-hidden />
            : undefined,
          onSelect: () => toggleValue(choice.value),
        }))}
      />
    </span>
  )
}

/**
 * One input, under the chip it belongs to.
 *
 * Deliberately not a form in a dialog: the whole point of the chip is that a
 * filter costs a tap and a number. Enter applies, Escape abandons, and a draft
 * that is abandoned takes its chip with it rather than leaving an empty one on
 * the row.
 *
 * Money is typed in whatever currency the person is reading, and converted on
 * the way into the clause — otherwise switching to dollars would quietly
 * change what every saved filter means.
 */
function ValueEditor({ field, value, currency, rates, onCommit, onCancel }: {
  field: FieldSpec
  value: string
  currency: Parameters<typeof fromBase>[1]
  rates: Parameters<typeof fromBase>[2]
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const money = field.type === 'money'
  const asShown = (stored: string) => {
    if (!money) return stored
    const number = Number(stored)
    return Number.isFinite(number) && stored !== ''
      ? String(Math.round(fromBase(Math.round(number * 100), currency, rates) / 100))
      : ''
  }

  const [text, setText] = useState(() => asShown(value))
  const input = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => { input.current?.focus(); input.current?.select() }, [])

  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (panel.current?.contains(event.target as Node)) return
      // The chip's own buttons are siblings of this panel, so a click on the
      // value button must not be read as a dismissal and then reopened.
      if (panel.current?.parentElement?.contains(event.target as Node)) return
      onCancel()
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [onCancel])

  const submit = () => {
    const raw = text.trim()
    if (!raw) { onCommit(''); return }
    if (!money) { onCommit(raw); return }
    const typed = Number(raw.replace(/[^\d.-]/g, ''))
    if (!Number.isFinite(typed)) { onCommit(''); return }
    onCommit(String(Math.round(toBase(Math.round(typed * 100), currency, rates) / 100)))
  }

  const type = field.type === 'date' ? 'date' : money || field.type === 'number' ? 'number' : 'text'

  return (
    <div
      ref={panel}
      className="absolute left-0 top-[calc(100%+6px)] z-40 w-[220px] rounded-md border border-line-subtle bg-surface-raised p-2 shadow-overlay"
    >
      <label className="relative flex items-center">
        <span className="sr-only">{field.label}</span>
        {money && (
          <span className="pointer-events-none absolute left-2.5 text-caption text-content-secondary">
            {CURRENCY_SYMBOLS[currency]}
          </span>
        )}
        <input
          ref={input}
          type={type}
          value={text}
          inputMode={money || field.type === 'number' ? 'decimal' : undefined}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); submit() }
            if (event.key === 'Escape') { event.preventDefault(); onCancel() }
          }}
          placeholder={field.type === 'text' ? 'Type to match…' : undefined}
          className={cn(
            'h-9 w-full rounded-sm border border-line-subtle bg-surface-subtle pr-2 text-caption text-content-primary placeholder:text-content-muted',
            money ? 'pl-6' : 'pl-2',
          )}
        />
      </label>
      <button
        type="button"
        onClick={submit}
        className="mt-2 h-8 w-full rounded-sm bg-content-primary text-caption font-semibold text-surface-raised"
      >
        Apply
      </button>
    </div>
  )
}
