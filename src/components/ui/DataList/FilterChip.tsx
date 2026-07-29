'use client'

import { useRef, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { AnchoredMenu } from '../AnchoredMenu'
import { cn } from '@/lib/cn'
import {
  describeClause, operatorsFor, OPERATOR_LABELS, validateClause,
  type FieldSpec, type FilterClause, type FilterOperator,
} from '@/lib/filters'

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
 */
export function FilterChip({ clause, field, options, onChange, onRemove }: {
  clause: FilterClause
  field: FieldSpec
  /** Reference options resolved by the page — brands, locations, people. */
  options?: ReadonlyArray<{ value: string; label: string }>
  onChange: (next: FilterClause) => void
  onRemove: () => void
}) {
  const valueTrigger = useRef<HTMLButtonElement>(null)
  const operatorTrigger = useRef<HTMLButtonElement>(null)
  const [valuesOpen, setValuesOpen] = useState(false)
  const [operatorsOpen, setOperatorsOpen] = useState(false)

  const choices = field.options ?? options ?? []
  const operators = operatorsFor(field)
  const resolve = (_key: string, value: string) =>
    choices.find((choice) => choice.value === value)?.label

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

  const editable = choices.length > 0 && (clause.operator === 'is' || clause.operator === 'isNot')

  return (
    <span className="inline-flex items-center rounded-pill border border-line-subtle bg-surface-raised text-caption">
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
        onClick={() => editable && setValuesOpen((value) => !value)}
        aria-haspopup={editable ? 'menu' : undefined}
        aria-expanded={editable ? valuesOpen : undefined}
        className={cn(
          'py-1.5 pr-1 font-semibold text-content-primary',
          editable && 'hover:text-content-accent',
        )}
      >
        {describeClause(clause, [field], resolve).replace(`${field.label} ${OPERATOR_LABELS[clause.operator]} `, '') || '—'}
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
