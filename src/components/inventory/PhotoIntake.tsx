'use client'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, Card, useToast } from '@/components/ui'
import { downscaleImage } from '@/lib/downscale'
import { matchPhotos, type MatchCandidate } from '@/lib/photo-match'
import { IMAGE_KINDS, IMAGE_KIND_LABELS, type ImageKind } from '@/lib/enums'

export interface PhotoCandidate extends MatchCandidate {
  model: string
  brandName: string
}

interface Pending {
  key: string
  file: File
  preview: string
  watchId: string | null
  /** How the match was arrived at, or why there isn't one. */
  note: string | null
  auto: boolean
  kind: ImageKind
  state: 'ready' | 'saving' | 'saved' | 'failed'
  error: string | null
}

/**
 * Attach a batch of photographs to the watches they belong to.
 *
 * The matching is a proposal and nothing more. It reads the filename, which
 * is right often enough to save real time and wrong often enough that it must
 * never be the last word: a warranty card on the wrong watch is a document
 * claiming a history that watch does not have. So nothing is written until
 * somebody has seen every row, and the rows it could not place are put at the
 * top rather than hidden at the bottom.
 */
export function PhotoIntake({ candidates }: { candidates: PhotoCandidate[] }) {
  const router = useRouter()
  const toast = useToast()
  const input = useRef<HTMLInputElement | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState(false)

  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates])
  const describe = (id: string) => {
    const c = byId.get(id)
    return c ? `${c.stockNo} · ${c.brandName} ${c.model}` : 'Unknown watch'
  }

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
          note: m.watchId ? `Matched on ${m.reason}` : m.note,
          auto: Boolean(m.watchId),
          // These are warranty cards far more often than anything else, which
          // is the job this page exists for. Still per-row changeable.
          kind: 'CARD' as ImageKind,
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

  const unplaced = pending.filter((p) => !p.watchId && p.state !== 'saved').length
  const ready = pending.filter((p) => p.watchId && p.state !== 'saved')

  const save = async () => {
    setSaving(true)
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
      } catch {
        update(item.key, { state: 'failed', error: 'Something went wrong reading that file.' })
      }
    }
    setSaving(false)
    const saved = pending.filter((p) => p.state === 'saved').length
    toast.success(`${ready.length} photograph${ready.length === 1 ? '' : 's'} attached`)
    if (saved || ready.length) router.refresh()
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
              Named with the serial or the stock number — <span className="tabular-nums">466787F0.jpg</span> or{' '}
              <span className="tabular-nums">IMG_4821_466787F0.jpg</span> — and each one is matched for you.
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
            </p>
            <Button onClick={save} disabled={saving || ready.length === 0}>
              {saving ? 'Saving…' : `Attach ${ready.length} photograph${ready.length === 1 ? '' : 's'}`}
            </Button>
          </div>

          <ul className="divide-y divide-line-subtle">
            {/* Unplaced first: the ones needing a decision are the reason
                somebody is looking at this list at all. */}
            {[...pending].sort((a, b) => Number(Boolean(a.watchId)) - Number(Boolean(b.watchId))).map((p) => (
              <li key={p.key} className="flex items-center gap-4 px-5 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.preview}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-sm border border-line-subtle object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-small font-semibold text-content-primary">{p.file.name}</p>
                  <p className={cn('truncate text-caption', p.watchId ? 'text-content-secondary' : 'text-state-warning')}>
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
                    auto: false,
                    note: e.target.value ? 'Chosen by hand' : 'No watch chosen.',
                  })}
                  disabled={p.state === 'saved'}
                  className={cn(
                    'h-9 w-[260px] shrink-0 cursor-pointer appearance-none rounded-sm border bg-surface-raised pl-2.5 pr-3 text-small text-content-primary outline-none focus:border-teal-500',
                    p.watchId ? 'border-line-subtle' : 'border-state-warning',
                  )}
                >
                  <option value="">Choose a watch…</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.stockNo} · {c.brandName} {c.model}{c.serial ? ` · ${c.serial}` : ''}
                    </option>
                  ))}
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
                    <button
                      type="button"
                      onClick={() => remove(p.key)}
                      aria-label={`Remove ${p.file.name}`}
                      className="rounded-sm p-1 text-content-secondary hover:bg-surface-subtle hover:text-state-danger"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
              </li>
            ))}
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
        {candidates.filter((c) => !c.serial).length} of them have no serial recorded, so those can only be matched
        by stock number or chosen by hand.
      </p>
    </div>
  )
}
