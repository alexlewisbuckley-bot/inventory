'use client'
import { useEffect, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Trap Tab focus inside `ref` while `active`, restoring focus to the previously
 * focused element on close. Required for WCAG 2.1 (2.4.3 Focus Order) in any
 * modal or drawer.
 */
export function useFocusTrap(ref: RefObject<HTMLElement>, active: boolean, onEscape?: () => void): void {
  useEffect(() => {
    if (!active) return
    const container = ref.current
    if (!container) return

    const previous = document.activeElement as HTMLElement | null
    const focusables = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((el) => el.offsetParent !== null || el === document.activeElement)

    // Move focus in on open, preferring an explicitly marked target.
    const initial = container.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? container
    requestAnimationFrame(() => initial.focus())

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && onEscape) {
        event.stopPropagation()
        onEscape()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]!
      const last = items[items.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      previous?.focus?.()
    }
  }, [ref, active, onEscape])
}

/** Prevent background scroll while an overlay is open, without layout shift. */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const { overflow, paddingRight } = document.body.style
    const gap = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (gap > 0) document.body.style.paddingRight = `${gap}px`
    return () => {
      document.body.style.overflow = overflow
      document.body.style.paddingRight = paddingRight
    }
  }, [active])
}
