'use client'
import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { CommandPalette } from './CommandPalette'
import { PeekHost } from '@/components/ui/Peek'

/**
 * Search affordance in the header. Owns the palette's open state and the
 * global Cmd/Ctrl-K shortcut.
 */
export function CommandTrigger() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-md border border-line-subtle px-3 text-small text-content-secondary transition-colors hover:border-line-strong"
        aria-label="Search — press Command K"
      >
        <Search className="h-4 w-4" aria-hidden />
        <span className="hidden lg:inline">Search…</span>
        <kbd className="hidden rounded-xs border border-line-subtle px-1.5 py-0.5 font-sans text-micro font-semibold lg:inline">
          ⌘K
        </kbd>
      </button>
      <CommandPalette open={open} onClose={() => setOpen(false)} />
      {/* One overlay for the whole application. Any row anywhere asks for a
          preview by firing an event; mounting a host per table would put four
          of them on screen racing to trap focus. */}
      <PeekHost />
    </>
  )
}
