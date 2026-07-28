'use client'
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

const control =
  'w-full rounded-md bg-surface-raised border px-3.5 py-3 text-body text-content-primary ' +
  'placeholder:text-content-secondary transition-colors ' +
  'disabled:opacity-60 disabled:cursor-not-allowed'

const normal = 'border-line-subtle hover:border-line-strong'
const invalid = 'border-state-danger'

interface WrapperProps {
  label?: string
  hint?: ReactNode
  error?: string
  required?: boolean
  className?: string
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

/**
 * Label + control + hint/error wrapper.
 *
 * Wiring `aria-describedby` and `aria-invalid` here means every form control in
 * the app is announced correctly without each caller remembering to do it.
 */
export function Field({ label, hint, error, required, className, children }: WrapperProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-caption font-semibold text-content-secondary">
          {label}
          {required && <span className="text-state-danger ml-0.5" aria-hidden>*</span>}
        </label>
      )}
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={errorId} role="alert" className="text-caption text-state-danger">{error}</p>
      ) : hint ? (
        <p id={hintId} className="text-caption text-content-secondary">{hint}</p>
      ) : null}
    </div>
  )
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  label?: string; hint?: ReactNode; error?: string; className?: string; prefix?: string
}

export const TextField = forwardRef<HTMLInputElement, InputProps>(function TextField(
  { label, hint, error, className, required, prefix, ...rest }, ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {({ id, describedBy, invalid: bad }) => (
        <div className="relative">
          {prefix && (
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-body text-content-secondary">
              {prefix}
            </span>
          )}
          <input
            ref={ref}
            id={id}
            required={required}
            aria-invalid={bad || undefined}
            aria-describedby={describedBy}
            className={cn(control, bad ? invalid : normal, prefix && 'pl-8')}
            {...rest}
          />
        </div>
      )}
    </Field>
  )
})

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & {
  label?: string; hint?: ReactNode; error?: string; className?: string
  options: Array<{ value: string; label: string; disabled?: boolean }>
  placeholder?: string
}

export const SelectField = forwardRef<HTMLSelectElement, SelectProps>(function SelectField(
  { label, hint, error, className, required, options, placeholder, ...rest }, ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {({ id, describedBy, invalid: bad }) => (
        <div className="relative">
          <select
            ref={ref}
            id={id}
            required={required}
            aria-invalid={bad || undefined}
            aria-describedby={describedBy}
            className={cn(control, bad ? invalid : normal, 'appearance-none pr-10 cursor-pointer')}
            {...rest}
          >
            {placeholder && <option value="">{placeholder}</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-secondary"
            aria-hidden
          />
        </div>
      )}
    </Field>
  )
})

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & {
  label?: string; hint?: ReactNode; error?: string; className?: string
}

export const TextareaField = forwardRef<HTMLTextAreaElement, TextareaProps>(function TextareaField(
  { label, hint, error, className, required, rows = 3, ...rest }, ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {({ id, describedBy, invalid: bad }) => (
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          required={required}
          aria-invalid={bad || undefined}
          aria-describedby={describedBy}
          className={cn(control, bad ? invalid : normal, 'resize-y min-h-[88px]')}
          {...rest}
        />
      )}
    </Field>
  )
})

export const Checkbox = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode; hint?: string }>(
  function Checkbox({ label, hint, className, ...rest }, ref) {
    const id = useId()
    return (
      <div className={cn('flex items-start gap-3', className)}>
        <input
          ref={ref}
          id={id}
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 rounded-[4px] border-line-strong text-teal-500 accent-teal-500 cursor-pointer"
          {...rest}
        />
        <label htmlFor={id} className="text-body text-content-primary cursor-pointer select-none">
          {label}
          {hint && <span className="block text-caption text-content-secondary">{hint}</span>}
        </label>
      </div>
    )
  },
)

/** Radio-style selectable card, used for location pickers and role choices. */
export function RadioCard({ checked, onSelect, title, description, badge, disabled }: {
  checked: boolean; onSelect: () => void; title: ReactNode
  description?: ReactNode; badge?: ReactNode; disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left transition-colors',
        checked ? 'border-[1.5px] border-teal-500 bg-teal-100' : 'border-line-subtle bg-surface-raised hover:border-line-strong',
        disabled && 'opacity-50 pointer-events-none',
      )}
    >
      <span
        className={cn(
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2',
          checked ? 'border-teal-500 bg-teal-500' : 'border-line-strong bg-surface-raised',
        )}
        aria-hidden
      >
        {checked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-body font-bold text-content-primary">{title}</span>
          {badge}
        </span>
        {description && <span className="block text-caption text-content-secondary">{description}</span>}
      </span>
    </button>
  )
}
