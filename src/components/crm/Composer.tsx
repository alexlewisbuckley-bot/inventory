'use client'

import {
  useCallback, useEffect, useRef, useState, type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { useFormState, useFormStatus } from 'react-dom'
import { Plus } from 'lucide-react'
import { Button, Drawer, useToast } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { ActionState } from '@/app/actions/auth'

const INITIAL: ActionState = { ok: false }

/**
 * The one shape every "add something here" form takes.
 *
 * Four things needed creating in this release — a follow-up, a want, an offer
 * and a supplier enquiry — and four independently written forms would have
 * produced four different answers to the same six questions: where does the
 * trigger live, what closes it, what happens on success, where do field errors
 * appear, what does a Viewer see, and does the page know something changed.
 * They are answered once, here.
 *
 * Two presentations, because two genuinely different things are being asked
 * for. `inline` is a row that grows out of the list it adds to — right for a
 * task, where the whole point is not leaving the list. `drawer` is for a form
 * with more than four fields, where an inline row would push the list you were
 * reading off the bottom of the screen.
 *
 * What it does not do: render a disabled control for somebody who lacks the
 * permission. A greyed-out button is an advertisement for a thing you cannot
 * have. Callers pass `can={false}` and get nothing.
 */
export function Composer({
  action,
  can = true,
  presentation = 'inline',
  label,
  title,
  subtitle,
  submitLabel,
  scope,
  fields,
  onDone,
  className,
}: {
  /** The server action. Must return an `ActionState`. */
  action: (prev: ActionState, data: FormData) => Promise<ActionState>
  /** False hides the composer entirely. */
  can?: boolean
  presentation?: 'inline' | 'drawer'
  /** Trigger text — "Add a follow-up". Also the collapsed row's prompt. */
  label: string
  /** Drawer heading. Defaults to `label`. */
  title?: string
  subtitle?: string
  submitLabel?: string
  /** Hidden inputs that fix what this composer is attached to. */
  scope?: Record<string, string | null | undefined>
  /** The fields. Receives the last action state so errors can be placed. */
  fields: (state: ActionState) => ReactNode
  onDone?: () => void
  className?: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [state, submit] = useFormState(action, INITIAL)
  const [open, setOpen] = useState(false)

  // Bumped on every success so the uncontrolled inputs are thrown away rather
  // than cleared field by field — reopening a composer that still has the last
  // entry in it is the single most annoying thing a create form can do.
  const [generation, setGeneration] = useState(0)
  const firstField = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }, [])

  useEffect(() => {
    if (!state.ok) return
    setGeneration((n) => n + 1)
    setOpen(false)
    toast.success(state.message ?? 'Added')
    // The record it was added to, the list it appears on, and the counts above
    // both are all server-rendered — refreshing is what stops the new row
    // existing in the database and not on the screen.
    router.refresh()
    onDone?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // Focus the first control when the inline form opens. Without this the
  // keyboard user has to tab from the trigger they just activated into a form
  // that appeared below it, which is one press too many for the action people
  // repeat most.
  useEffect(() => {
    if (!open || presentation !== 'inline') return
    const control = firstField.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]), select, textarea',
    )
    control?.focus()
  }, [open, presentation])

  if (!can) return null

  const body = (
    <form action={submit} key={generation} className="flex flex-col gap-4">
      {scope && Object.entries(scope).map(([name, value]) => (
        value ? <input key={name} type="hidden" name={name} value={value} /> : null
      ))}

      <div ref={firstField} className="flex flex-col gap-4">
        {fields(state)}
      </div>

      {state.message && !state.ok && (
        <p role="alert" className="text-small text-state-danger">{state.message}</p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" type="button" size="sm" onClick={() => close()}>Cancel</Button>
        <Submit label={submitLabel ?? label} />
      </div>
    </form>
  )

  if (presentation === 'drawer') {
    return (
      <>
        <Button
          ref={trigger}
          size="sm"
          variant="secondary"
          icon={<Plus className="h-4 w-4" />}
          onClick={() => setOpen(true)}
          className={className}
        >
          {label}
        </Button>
        <Drawer open={open} onClose={() => close()} title={title ?? label} subtitle={subtitle}>
          {body}
        </Drawer>
      </>
    )
  }

  return (
    <div
      className={cn('border-t border-line-subtle', className)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          close()
        }
      }}
    >
      {open ? (
        <div className="px-6 py-4">{body}</div>
      ) : (
        <button
          ref={trigger}
          type="button"
          onClick={() => setOpen(true)}
          // h-11 rather than padding: the collapsed trigger is a control on the
          // 32/40/44 scale, and derived height put it at 48px — a size the
          // system does not have, which the computed-style audit caught.
          className="flex h-11 w-full items-center gap-2 px-6 text-left text-small font-semibold text-content-secondary transition-colors hover:bg-surface-subtle hover:text-content-accent"
        >
          <Plus className="h-4 w-4 shrink-0" aria-hidden />
          {label}
        </button>
      )}
    </div>
  )
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return <Button type="submit" size="sm" loading={pending}>{label}</Button>
}
