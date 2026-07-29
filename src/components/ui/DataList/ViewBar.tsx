'use client'

import { useRef, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Bookmark, Check, MoreHorizontal, Plus, Users } from 'lucide-react'
import { AnchoredMenu } from '../AnchoredMenu'
import { Button } from '../Button'
import { Modal } from '../Modal'
import { Checkbox, TextField } from '../Field'
import { useToast } from '../Toast'
import {
  deleteViewAction, saveViewAction, setViewSharedAction, updateViewQueryAction,
} from '@/app/actions/views'
import { cn } from '@/lib/cn'

export interface BuiltInView {
  id: string
  label: string
  /** The query string this view applies, without the leading '?'. */
  query: string
  description?: string
}

export interface SavedView {
  id: string
  name: string
  query: string
  shared: boolean
  mine: boolean
}

/**
 * The views on a list — the ones that shipped and the ones somebody made.
 *
 * V1 had six, hard-coded, and no seventh was possible. So the queries people
 * actually run every morning — this supplier's consignment stock, everything
 * over twenty thousand that has not moved, trade contacts in the Gulf — stayed
 * as three dropdown interactions rebuilt from memory, several times a day, for
 * the life of the product.
 *
 * Two rules make it work rather than becoming a second navigation:
 *
 * A view is only the query string. It composes with whatever is already in the
 * URL rather than replacing the page, which is why applying one keeps your
 * column layout and why "Save this view" is a button rather than a form.
 *
 * A view is active when the URL *is* its query, compared as a set. String
 * equality would fail the moment somebody's browser reordered the parameters,
 * and a chip that will not light up when you are plainly looking at it is a
 * chip people stop pressing.
 */
export function ViewBar({ object, builtIn, saved, canSave = true }: {
  object: string
  builtIn: readonly BuiltInView[]
  saved: readonly SavedView[]
  canSave?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const toast = useToast()
  const [pending, start] = useTransition()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const menuTrigger = useRef<HTMLButtonElement>(null)

  const apply = (query: string) => {
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  /**
   * Set comparison, not string comparison.
   *
   * `status=SOLD&q=rolex` and `q=rolex&status=SOLD` are the same view, and a
   * chip that fails to light up when you are looking at exactly what it
   * describes is a chip people quietly stop pressing.
   */
  const isActive = (query: string): boolean => {
    const wanted = new URLSearchParams(query)
    const IGNORED = new Set(['page', 'watch', 'cols'])

    const normalise = (source: URLSearchParams) => {
      const pairs: string[] = []
      for (const [key, value] of source.entries()) {
        if (IGNORED.has(key)) continue
        pairs.push(`${key}=${value}`)
      }
      return pairs.sort().join('&')
    }
    return normalise(wanted) === normalise(params)
  }

  const currentQuery = () => {
    const next = new URLSearchParams(params.toString())
    // The page number is where you happened to be, not part of what the view
    // means. Saving it means the view opens on page 3 tomorrow, when the data
    // underneath it has moved.
    next.delete('page')
    return next.toString()
  }

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    start(async () => {
      const result = await saveViewAction(object, trimmed, currentQuery(), shared)
      if (!result.ok) {
        toast.error('Could not save that view', result.message)
        return
      }
      setSaving(false)
      setName('')
      setShared(false)
      toast.success('View saved', result.message)
      router.refresh()
    })
  }

  const act = (label: string, run: () => Promise<{ ok: boolean; message?: string }>) => {
    start(async () => {
      const result = await run()
      if (!result.ok) { toast.error(label, result.message); return }
      toast.success(result.message ?? 'Done')
      setMenuFor(null)
      router.refresh()
    })
  }

  const open = saved.find((view) => view.id === menuFor)

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="Views">
      {builtIn.map((view) => (
        <button
          key={view.id}
          type="button"
          onClick={() => apply(view.query)}
          aria-pressed={isActive(view.query)}
          title={view.description}
          className={chipClass(isActive(view.query))}
        >
          {view.label}
        </button>
      ))}

      {saved.length > 0 && <span className="mx-1 h-5 w-px bg-line-subtle" aria-hidden />}

      {saved.map((view) => {
        const active = isActive(view.query)
        return (
          <span key={view.id} className="inline-flex items-center">
            <button
              type="button"
              onClick={() => apply(view.query)}
              aria-pressed={active}
              className={cn(chipClass(active), 'rounded-r-none pr-2')}
            >
              {view.shared
                ? <Users className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                : <Bookmark className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
              {view.name}
            </button>
            {view.mine && (
              <button
                type="button"
                ref={menuFor === view.id ? menuTrigger : undefined}
                onClick={() => setMenuFor(menuFor === view.id ? null : view.id)}
                aria-label={`Options for the ${view.name} view`}
                aria-haspopup="menu"
                className={cn(chipClass(active), 'rounded-l-none px-1.5')}
              >
                <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </span>
        )
      })}

      {canSave && (
        <Button
          variant="ghost"
          size="sm"
          icon={<Plus className="h-4 w-4" />}
          onClick={() => setSaving(true)}
          disabled={pending}
        >
          Save this view
        </Button>
      )}

      {open && (
        <AnchoredMenu
          open
          onClose={() => setMenuFor(null)}
          anchorRef={menuTrigger}
          label={`${open.name} view`}
          items={[
            {
              id: 'update',
              label: 'Update it to match this list',
              onSelect: () => act('Could not update that view',
                () => updateViewQueryAction(open.id, currentQuery())),
            },
            {
              id: 'share',
              label: open.shared ? 'Make it private' : 'Share it with the team',
              icon: open.shared ? <Check className="h-4 w-4" aria-hidden /> : undefined,
              onSelect: () => act('Could not change who can see that view',
                () => setViewSharedAction(open.id, !open.shared)),
            },
            {
              id: 'delete',
              label: 'Delete it',
              tone: 'danger' as const,
              separated: true,
              onSelect: () => act('Could not delete that view', () => deleteViewAction(open.id)),
            },
          ]}
        />
      )}

      <Modal
        open={saving}
        onClose={() => setSaving(false)}
        title="Save this view"
        description="The search, filters, sorting and column choices you are looking at now."
        footer={
          <>
            <Button variant="ghost" onClick={() => setSaving(false)}>Cancel</Button>
            <Button onClick={save} loading={pending} disabled={!name.trim()}>Save it</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <TextField
            label="Call it"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Consignment stock over £20k"
            hint="Something you would recognise in a row of chips."
            autoFocus
            maxLength={60}
          />
          <Checkbox
            checked={shared}
            onChange={(event) => setShared(event.target.checked)}
            label="Share it with the team"
            hint="Everybody can use it; only you can change it."
          />
        </div>
      </Modal>
    </div>
  )
}

function chipClass(active: boolean): string {
  return cn(
    'inline-flex h-9 items-center rounded-md px-3 text-small font-semibold transition-colors',
    active
      ? 'bg-navy-700 text-white'
      : 'text-content-secondary hover:bg-surface-subtle hover:text-content-primary',
  )
}
