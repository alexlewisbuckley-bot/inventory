'use client'
import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { ChevronDown, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Every form control is 44px tall.
 *
 * Height is set rather than derived from padding, because padding plus a
 * line-height gives a different answer for an input, a select and a bordered
 * wrapper — which is how a search box ended up 4px taller than the filter
 * pills sitting beside it. 44px is also the touch-target floor, so the same
 * number serves both.
 */
const CONTROL_HEIGHT = 'h-11'

const control =
  `w-full ${CONTROL_HEIGHT} rounded-md bg-surface-raised border px-3.5 text-body text-content-primary ` +
  'placeholder:text-content-muted transition-colors ' +
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
  { label, hint, error, className, required, prefix, type, ...rest }, ref,
) {
  // A password field you cannot read is where typos go to hide, and the
  // recovery from one is retyping the whole thing. Every password field gets a
  // reveal; it is never on by default, and the button says which state it will
  // move you to rather than which state you are in.
  const [revealed, setRevealed] = useState(false)
  const isPassword = type === 'password'
  const resolvedType = isPassword && revealed ? 'text' : type

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
            type={resolvedType}
            required={required}
            aria-invalid={bad || undefined}
            aria-describedby={describedBy}
            className={cn(control, bad ? invalid : normal, prefix && 'pl-8', isPassword && 'pr-11')}
            {...rest}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setRevealed((value) => !value)}
              aria-label={revealed ? 'Hide password' : 'Show password'}
              aria-pressed={revealed}
              className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-sm text-content-secondary transition-colors hover:bg-surface-subtle hover:text-content-primary"
            >
              {revealed ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            </button>
          )}
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
          // The one control that must grow with its content.
            className={cn(control, bad ? invalid : normal, 'h-auto min-h-[88px] resize-y py-3')}
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
          className="mt-0.5 h-4 w-4 shrink-0 rounded-xs border-line-strong text-teal-500 accent-teal-500 cursor-pointer"
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
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-pill border-2',
          checked ? 'border-teal-500 bg-teal-500' : 'border-line-strong bg-surface-raised',
        )}
        aria-hidden
      >
        {checked && <span className="h-1.5 w-1.5 rounded-pill bg-white" />}
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

/**
 * A two-or-three-way choice, shown as a segmented control.
 *
 * A select hides the options behind a click, which is wrong when the choice is
 * short, mutually exclusive and consequential — the kind you want to see the
 * state of at a glance rather than read. Radio inputs underneath, so it is
 * keyboard-navigable with the arrow keys and announced as a group.
 */
export function SegmentedField<T extends string>({
  name, label, hint, error, value, onChange, options, className,
}: {
  name: string
  label?: string
  hint?: ReactNode
  error?: string
  value: T
  onChange: (value: T) => void
  options: Array<{ value: T; label: string; description?: string }>
  className?: string
}) {
  const id = useId()
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  const active = options.find((option) => option.value === value)

  return (
    <fieldset className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <legend className="text-caption font-semibold text-content-secondary">{label}</legend>
      )}
      <div
        className="inline-flex w-full rounded-md border border-line-subtle bg-surface-subtle p-1"
        aria-describedby={describedBy}
      >
        {options.map((option) => {
          const selected = option.value === value
          return (
            <label
              key={option.value}
              className={cn(
                'relative flex h-9 flex-1 cursor-pointer items-center justify-center gap-2 rounded-sm px-3 text-small font-semibold transition-colors',
                selected
                  ? 'bg-surface-raised text-content-primary shadow-sm'
                  : 'text-content-secondary hover:text-content-primary',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          )
        })}
      </div>
      {error
        ? <p id={`${id}-error`} className="text-caption text-state-danger">{error}</p>
        : (active?.description || hint) && (
          <p id={`${id}-hint`} className="text-caption text-content-secondary">
            {active?.description ?? hint}
          </p>
        )}
    </fieldset>
  )
}
