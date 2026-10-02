'use client'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, Card, useToast } from '@/components/ui'
import { downscaleImage } from '@/lib/downscale'
import { guessKind, matchPhotos, type MatchCandidate } from '@/lib/photo-match'
import { IMAGE_KINDS, IMAGE_KIND_LABELS, type ImageKind } from '@/lib/enums'

export interface PhotoCandidate extends MatchCandidate {
  brandName: string
}

interface Pending {
  key: string
  file: File
  preview: string
  watchId: string | null
  /** How the match was arrived at, or why there isn't one. */
  note: string | null
  /**
   * Whether the filename said this watch or merely came close.
   *
   * A near match is shown attached, because a reference typed one character
   * out is far more useful found than not — but it is marked, counted apart
   * from the certain ones, and sorted to where it will be looked at.
   */
  exact: boolean
  /** The watches it was choosing between, when more than one answered. */
  choices: string[]
  kind: ImageKind
  state: 'ready' | 'saving' | 'saved' | 'failed'
  error: string | null
}

/** Unplaced first, then the guesses, then the certain ones. */
const TRIAGE = (p: Pending) => (!p.watchId ? 0 : p.exact ? 2 : 1)

/**
 * Attach a batch of photographs to the watches they belong to.
 *
 * The matching is a proposal and nothing more. It reads the filename, which
 * is right often enough to save real time and wrong often enough that it must
 * never be the last word: a warranty card on the wrong watch is a document
 * claiming a history that watch does not have. So nothing is written until
 * somebody has seen every row, the rows it could not place are put at the top
 * rather than hidden at the bottom, and the rows it guessed at sit right
 * behind them.
 */
export function PhotoIntake({ candidates }: { candidates: PhotoCandidate[] }) {
  const router = useRouter()
  const toast = useToast()
  const input = useRef<HTMLInputElement | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState(false)

  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates])
  const label = (c: PhotoCandidate) =>
    `${c.stockNo} · ${c.brandName} ${c.reference}${c.serial ? ` · ${c.serial}` : ''}`

  const accept = (files: FileList | null) => {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'))
    if (!list.length) return
    const matches = matchPhotos(list.map((f) => f.name), candidates)
    setPending((current) => [
      ...current,
      ...list.map((file, i) => {
        const m = matches[i]!
        return {
          key: `${file.name}-${file.size}-${Date.now()}-${i}`,
          file,
          preview: URL.createObjectURL(file),
          watchId: m.watchId,
          note: m.note,
          exact: m.exact,
          choices: m.candidates,
          // A guess from the filename, so that seventy-three of these are not
          // set one at a time. Changeable per row, and in bulk above.
          kind: guessKind(file.name),
          state: 'ready' as const,
          error: null,
        }
      }),
    ])
  }

  const update = (key: string, patch: Partial<Pending>) =>
    setPending((current) => current.map((p) => (p.key === key ? { ...p, ...patch } : p)))

  const remove = (key: string) =>
    setPending((current) => {
      const gone = current.find((p) => p.key === key)
      if (gone) URL.revokeObjectURL(gone.preview)
      return current.filter((p) => p.key !== key)
    })

  /** One decision for the whole batch, which is how these actually arrive. */
  const setAllKinds = (kind: ImageKind) =>
    setPending((current) => current.map((p) => (p.state === 'saved' ? p : { ...p, kind })))

  const open = pending.filter((p) => p.state !== 'saved')
  const unplaced = open.filter((p) => !p.watchId).length
  const guessed = open.filter((p) => p.watchId && !p.exact).length
  const ready = open.filter((p) => p.watchId)

  const save = async () => {
    setSaving(true)
    let attached = 0
    for (const item of ready) {
      update(item.key, { state: 'saving', error: null })
      try {
        const { file, width, height } = await downscaleImage(item.file)
        const body = new FormData()
        body.set('file', file)
        body.set('watchId', item.watchId!)
        body.set('kind', item.kind)
        body.set('width', String(width))
        body.set('height', String(height))
        const response = await fetch('/api/images/upload', { method: 'POST', body })
        const payload = await response.json()
        if (!response.ok) {
          update(item.key, { state: 'failed', error: payload.error ?? 'The upload was refused.' })
          continue
        }
        update(item.key, { state: 'saved' })
        attached += 1
      } catch {
        update(item.key, { state: 'failed', error: 'Something went wrong reading that file.' })
      }
    }
    setSaving(false)
    if (attached) {
      toast.success(`${attached} photograph${attached === 1 ? '' : 's'} attached`)
      router.refresh()
    }
    if (attached < ready.length) {
      toast.error(`${ready.length - attached} could not be attached. They are still listed below.`)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files) }}
          className={cn(
            'flex flex-col items-center gap-3 rounded-md border border-dashed px-6 py-12 text-center transition-colors',
            dragging ? 'border-teal-500 bg-teal-100/50' : 'border-line-subtle bg-surface-subtle',
          )}
        >
          <ImagePlus className="h-6 w-6 text-content-secondary" aria-hidden />
          <div>
            <p className="text-body font-semibold text-content-primary">Drop photographs here</p>
            <p className="mt-1 text-small text-content-secondary">
              Named with the reference, the serial or the stock number —{' '}
              <span className="tabular-nums">5167R.png</span>,{' '}
              <span className="tabular-nums">466787F0.jpg</span> or{' '}
              <span className="tabular-nums">IMG_4821_1378.jpg</span> — and each one is matched for you.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>
            Choose files
          </Button>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(e) => { accept(e.target.files); e.target.value = '' }}
          />
        </div>
      </Card>

      {pending.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle px-5 py-3">
            <p className="text-small text-content-secondary">
              {pending.length} photograph{pending.length === 1 ? '' : 's'}
              {unplaced > 0 && (
                <>
                  {' · '}
                  <span className="font-semibold text-state-warning">{unplaced} need a watch</span>
                </>
              )}
              {guessed > 0 && (
                <>
                  {' · '}
                  <span className="font-semibold text-state-warning">{guessed} to check</span>
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
              {/* Setting the kind seventy-three times is the thing that makes a
                  batch tool not a batch tool. */}
              <label className="flex items-center gap-2 text-caption text-content-secondary">
                Set all to
                <select
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) setAllKinds(e.target.value as ImageKind) }}
                  className="h-9 cursor-pointer appearance-none rounded-sm border border-line-subtle bg-surface-raised pl-2.5 pr-3 text-small text-content-primary outline-none focus:border-teal-500"
                >
                  <option value="" disabled>Choose…</option>
                  {IMAGE_KINDS.map((k) => <option key={k} value={k}>{IMAGE_KIND_LABELS[k]}</option>)}
                </select>
              </label>
              <Button onClick={save} disabled={saving || ready.length === 0}>
                {saving ? 'Saving…' : `Attach ${ready.length} photograph${ready.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>

          {/* The rules between rows are drawn per row rather than with
              `divide-y`, because `divide-{color}` sets border-color on every
              side at a specificity the row's own left-edge accent cannot
              beat — and that accent is how an unplaced or guessed row
              announces itself. */}
          <ul>
            {[...pending].sort((a, b) => TRIAGE(a) - TRIAGE(b)).map((p) => {
              const guess = Boolean(p.watchId) && !p.exact && p.state !== 'saved'
              // When the filename named something real but several watches
              // answered to it, the picker is narrowed to those. That turns
              // "find it among forty" into "pick one of three".
              const likely = p.choices.length > 1 ? p.choices : []
              return (
                <li
                  key={p.key}
                  className={cn(
                    'flex items-center gap-4 border-l-2 border-t border-t-line-subtle px-5 py-3 first:border-t-0',
                    !p.watchId && p.state !== 'saved'
                      ? 'border-l-state-warning bg-state-warning/[0.06]'
                      : guess
                        ? 'border-l-state-warning/60'
                        : 'border-l-transparent',
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.preview}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-sm border border-line-subtle object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-small font-semibold text-content-primary">{p.file.name}</p>
                    <p
                      className={cn(
                        'truncate text-caption',
                        p.state === 'failed' || !p.watchId || guess ? 'text-state-warning' : 'text-content-secondary',
                      )}
                    >
                      {p.state === 'failed' ? p.error : p.note}
                    </p>
                  </div>

                  <select
                    value={p.kind}
                    aria-label={`Kind for ${p.file.name}`}
                    onChange={(e) => update(p.key, { kind: e.target.value as ImageKind })}
                    disabled={p.state === 'saved'}
                    className="h-9 shrink-0 cursor-pointer appearance-none rounded-sm border border-line-subtle bg-surface-raised pl-2.5 pr-3 text-small text-content-primary outline-none focus:border-teal-500"
                  >
                    {IMAGE_KINDS.map((k) => <option key={k} value={k}>{IMAGE_KIND_LABELS[k]}</option>)}
                  </select>

                  <select
                    value={p.watchId ?? ''}
                    aria-label={`Watch for ${p.file.name}`}
                    onChange={(e) => update(p.key, {
                      watchId: e.target.value || null,
                      // Chosen by hand is as exact as it gets, and it clears
                      // the flag the guess was carrying.
                      exact: Boolean(e.target.value),
                      note: e.target.value ? 'Chosen by hand' : 'No watch chosen.',
                    })}
                    disabled={p.state === 'saved'}
                    className={cn(
                      'h-9 w-[260px] shrink-0 cursor-pointer appearance-none rounded-sm border bg-surface-raised pl-2.5 pr-3 text-small text-content-primary outline-none focus:border-teal-500',
                      p.watchId && !guess ? 'border-line-subtle' : 'border-state-warning',
                    )}
                  >
                    <option value="">Choose a watch…</option>
                    {likely.length > 0 && (
                      <optgroup label="Matches the filename">
                        {likely.map((id) => {
                          const c = byId.get(id)
                          return c ? <option key={id} value={id}>{label(c)}</option> : null
                        })}
                      </optgroup>
                    )}
                    <optgroup label={likely.length > 0 ? 'All stock' : 'Stock'}>
                      {candidates.map((c) => (
                        <option key={c.id} value={c.id}>{label(c)}</option>
                      ))}
                    </optgroup>
                  </select>

                  <div className="flex w-[90px] shrink-0 items-center justify-end gap-2">
                    {p.state === 'saving' && <Loader2 className="h-4 w-4 animate-spin text-content-secondary" aria-hidden />}
                    {p.state === 'saved' && (
                      <span className="inline-flex items-center gap-1 text-caption font-semibold text-content-accent">
                        <Check className="h-3.5 w-3.5" aria-hidden /> Saved
                      </span>
                    )}
                    {p.state === 'failed' && <AlertTriangle className="h-4 w-4 text-state-danger" aria-hidden />}
                    {p.state === 'ready' && (
                      <>
                        {guess && (
                          <span title="Closest match — check it">
                            <AlertTriangle className="h-4 w-4 text-state-warning" aria-hidden />
                            <span className="sr-only">Closest match — check it</span>
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => remove(p.key)}
                          aria-label={`Remove ${p.file.name}`}
                          className="rounded-sm p-1 text-content-secondary hover:bg-surface-subtle hover:text-state-danger"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          {pending.some((p) => p.state === 'saved') && (
            <p className="border-t border-line-subtle px-5 py-3 text-caption text-content-secondary">
              Saved photographs stay listed so you can see what went where. Open a watch to review its gallery.
            </p>
          )}
        </Card>
      )}

      <p className="text-caption text-content-secondary">
        {candidates.length} watches available to match against ·{' '}
        {candidates.filter((c) => !c.serial).length} of them have no serial recorded, so those are matched on the
        reference or the stock number.
      </p>
    </div>
  )
}
