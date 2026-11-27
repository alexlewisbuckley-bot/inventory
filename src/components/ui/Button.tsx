'use client'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-teal-500 text-content-on-accent hover:bg-teal-600 active:bg-teal-600',
  secondary: 'bg-transparent text-navy-700 border border-navy-700 hover:bg-navy-700/5',
  ghost: 'bg-transparent text-navy-700 hover:bg-navy-700/8',
  danger: 'bg-state-danger text-content-on-status hover:brightness-95',
  subtle: 'bg-surface-subtle text-content-primary border border-line-subtle hover:border-line-strong',
}

/*
 * The height is the touch target and does not move; the padding either side
 * of the label does, below sm.
 *
 * Two ordinary page actions — "Record a commission" and "Export" — came to
 * 378 pixels at these paddings, which is twenty more than a 390-wide phone
 * has between its gutters, so every page with two buttons in its header
 * stacked them and spent a hundred and sixty pixels doing it. Eight pixels a
 * side is the difference between one row and two.
 */
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[11px] gap-1.5 sm:px-3.5',
  md: 'h-11 px-4 text-[12px] gap-2 sm:px-6',
  lg: 'h-12 px-5 text-[13px] gap-2.5 sm:px-8',
}

interface BaseProps {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
  iconRight?: ReactNode
  fullWidth?: boolean
  children?: ReactNode
  className?: string
}

export interface ButtonProps extends BaseProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof BaseProps> {}

/*
 * The brand's button is a rectangle with tracked capitals in it — on the
 * site, on the cards, on the packaging. A bold pill is the other thing
 * entirely, and it was the second loudest tell after the corner radius.
 */
const base =
  'inline-flex items-center justify-center rounded-sm font-semibold uppercase tracking-[0.1em] whitespace-nowrap ' +
  'transition-[background-color,border-color,filter,opacity] duration-150 ' +
  'disabled:opacity-50 disabled:pointer-events-none select-none'

/**
 * Primary action control. `loading` disables interaction and swaps the leading
 * icon for a spinner while preserving the label, so the button does not resize
 * mid-submit and the accessible name never disappears.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, iconRight, fullWidth, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(base, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className)}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
      {!loading && iconRight}
    </button>
  )
})

export interface LinkButtonProps extends BaseProps {
  href: string
  prefetch?: boolean
  target?: string
  'aria-label'?: string
}

/** Anchor styled as a button, for navigation rather than actions. */
export function LinkButton({
  href, variant = 'primary', size = 'md', icon, iconRight, fullWidth, className, children, ...rest
}: LinkButtonProps) {
  return (
    <Link
      href={href}
      className={cn(base, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className)}
      {...rest}
    >
      {icon}
      {children}
      {iconRight}
    </Link>
  )
}

/** Square, label-less button for toolbars. `label` becomes the accessible name. */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'children'> & { label: string }>(
  function IconButton({ label, icon, size = 'md', variant = 'ghost', className, ...rest }, ref) {
    const box = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-12 w-12' : 'h-10 w-10'
    return (
      <button
        ref={ref}
        aria-label={label}
        title={label}
        className={cn(base, VARIANTS[variant], box, 'rounded-md p-0', className)}
        {...rest}
      >
        {icon}
      </button>
    )
  },
)
