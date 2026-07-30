'use client'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useTheme } from './ThemeProvider'
import type { Theme } from '@/lib/enums'

const OPTIONS: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: 'LIGHT', label: 'Light', icon: Sun },
  { value: 'DARK', label: 'Dark', icon: Moon },
  { value: 'SYSTEM', label: 'System', icon: Monitor },
]

/** Segmented light / dark / system control. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme()
  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      // 40px shell, 4px padding, 32px segments — `md` outside, `sm` inside,
      // both on the control scale. It used to be a 36px shell with `h-full`
      // segments, which produced a 30px control the system does not have.
      className="inline-flex h-10 items-center gap-0.5 rounded-md border border-line-subtle bg-surface-raised p-1"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-xs px-2.5 text-caption font-semibold transition-colors',
            theme === value ? 'bg-navy-700 text-white' : 'text-content-secondary hover:bg-surface-subtle',
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {!compact && label}
        </button>
      ))}
    </div>
  )
}
