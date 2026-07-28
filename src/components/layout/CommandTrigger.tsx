'use client'
import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { CommandPalette } from './CommandPalette'

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
        className="flex items-center gap-2 rounded-md border border-line-subtle px-3 py-2 text-small text-content-secondary transition-colors hover:border-line-strong"
        aria-label="Search — press Command K"
      >
        <Search className="h-4 w-4" aria-hidden />
        <span className="hidden lg:inline">Search…</span>
        <kbd className="hidden rounded-[4px] border border-line-subtle px-1.5 py-0.5 font-sans text-[10px] font-semibold lg:inline">
          ⌘K
        </kbd>
      </button>
      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </>
  )
}
