'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button } from './Button'

/**
 * The primary create action, in the page header where it belongs.
 *
 * Locations and Suppliers each floated their own "Add…" button above the
 * content on a line of its own, so the same action lived in three different
 * places depending on which page you were on. It now sits beside the page
 * title everywhere.
 *
 * State goes through the URL rather than being lifted into a wrapper, which
 * also makes the form deep-linkable: /suppliers?new opens it directly, so a
 * "add your first supplier" prompt anywhere can point straight at it.
 */
export function CreateAction({ label }: { label: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const open = () => {
    const next = new URLSearchParams(params.toString())
    next.set('new', '1')
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }

  return <Button icon={<Plus className="h-4 w-4" />} onClick={open}>{label}</Button>
}

/** Read and clear the `?new` flag from a manager component. */
export function useCreateFlag(): { open: boolean; close: () => void; openIt: () => void } {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const write = (value: '1' | null) => {
    const next = new URLSearchParams(params.toString())
    if (value) next.set('new', value)
    else next.delete('new')
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return {
    open: params.get('new') === '1',
    close: () => write(null),
    openIt: () => write('1'),
  }
}
