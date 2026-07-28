import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/cn'

/**
 * Regression guard for the design system's type scale.
 *
 * tailwind-merge classifies utilities into conflict groups. It does not know
 * our custom sizes, so without configuration `text-micro` is mistaken for a
 * colour and dropped when a real colour follows it — silently, with no error,
 * leaving type at whatever size it inherits. This was live across the
 * application.
 */
describe('class merging', () => {
  const SIZES = ['micro', 'caption', 'small', 'body', 'body-lg', 'h3', 'h2', 'h1', 'display']

  it('keeps a custom font size alongside a text colour', () => {
    for (const size of SIZES) {
      const result = cn(`text-${size}`, 'text-content-secondary')
      expect(result, `text-${size} was dropped`).toContain(`text-${size}`)
      expect(result).toContain('text-content-secondary')
    }
  })

  it('keeps the size when the colour comes first', () => {
    const result = cn('text-content-primary', 'text-h2')
    expect(result).toContain('text-h2')
    expect(result).toContain('text-content-primary')
  })

  it('still lets a later size override an earlier one', () => {
    const result = cn('text-body', 'text-h1')
    expect(result).toContain('text-h1')
    expect(result).not.toContain('text-body')
  })

  it('still lets a later colour override an earlier one', () => {
    const result = cn('text-content-secondary', 'text-state-danger')
    expect(result).toContain('text-state-danger')
    expect(result).not.toContain('text-content-secondary')
  })

  it('resolves ordinary conflicts as normal', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
    expect(cn('hidden', 'block')).toBe('block')
  })
})

describe('radius scale', () => {
  it('lets a caller override a component default', () => {
    // Without the radius group both survive and the browser takes the last
    // one in the stylesheet, not the last one written.
    expect(cn('rounded-md', 'rounded-pill')).toBe('rounded-pill')
    expect(cn('rounded-pill', 'rounded-xs')).toBe('rounded-xs')
  })

  it('does not confuse a radius with anything else', () => {
    expect(cn('rounded-md border-line-subtle')).toBe('rounded-md border-line-subtle')
  })
})
