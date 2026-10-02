'use client'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, ImagePlus, Loader2, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, Card, useToast } from '@/components/ui'
import { downscaleImage } from '@/lib/downscale'
import { guessKind, matchPhoto } from '@/lib/photo-match'
import { IMAGE_KINDS, IMAGE_KIND_LABELS, type ImageKind } from '@/lib/enums'
import { WatchPicker, type PickerWatch } from './WatchPicker'
import { StockRail } from './StockRail'

/** What the page hands over. The `name` used for ranking is built here. */
export interface PhotoCandidate extends Omit<PickerWatch, 'name'> {
  /** Photographs already held, counted by kind. */
  photographsByKind: Record<string, number>
}

/**
 * What to do about a watch that already has a photograph of this kind.
 *
 * Added photographs sort after the ones already there, and everything that
 * shows one watch shows the first — so adding to a watch that already has one
 * changes nothing anybody can see. That is right when you are building up a
 * gallery and wrong when you have just taken a better picture, and only the
 * person holding the photographs knows which. Never assumed: the other
 * reading deletes their work.
 */
export type ExistingMode = 'add' | 'replace'

interface Pending {
  key: string
  file: File
  preview: string
  /**
   * Every watch this photograph belongs to.
   *
   * A list, not a choice. A reference is a model: three Lady-Datejust 179383
   * in stock is ordinary and one photograph of that model belongs on all
   * three. Forcing that through a single-value picker meant the photograph
   * either went to the wrong watch or had to be uploaded three times.
   */
  watchIds: string[]
  /** How the match was arrived at, or why there isn't one. */
  note: string | null
  /** Whether the filename said these watches, or this is a judgement call. */
  exact: boolean
  /** Ranked watches to offer first when the filename named none. */
  shortlist: string[]
  kind: ImageKind
  /** Per photograph, so one watch in a batch can be treated differently. */
  mode: ExistingMode
  state: 'ready' | 'saving' | 'saved' | 'failed'
  error: string | null
}

/** Unplaced first, then the judgement calls, then the certain ones. */
const TRIAGE = (p: Pending) => (p.watchIds.length === 0 ? 0 : p.exact ? 2 : 1)

/**
 * Attach a batch of photographs to the watches they belong to.
 *
 * Two things shape this. The matching is a proposal and nothing more — a
 * warranty card on the wrong watch is a document claiming a history that
 * watch does not have, so nothing is written until somebody has seen every
 * row. And a photograph is not owned by one watch: it can belong to several,
 * and several belong to one, so assigning is adding to a set rather than
 * answering a question once.
 *
 * Hence the shape. The photographs run down the page with the watches they
 * are going to shown as chips beneath each one, and stock stands in a rail
 * beside them that any photograph can be dragged onto. Select a handful and
 * drag them across and twenty photographs join one watch in a gesture; drag
 * one photograph onto three watches and it goes to all three. Every drag has
 * a button that does the same thing, so none of it needs a mouse.
 */
export function PhotoIntake({ candidates }: { candidates: PhotoCandidate[] }) {
  const router = useRouter()
  const toast = useToast()
  const input = useRef<HTMLInputElement | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [dragging, setDragging] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [overDropZone, setOverDropZone] = useState(false)
  const lastClicked = useRef<string | null>(null)
  // Seventy-three photographs are rarely seventy-three different watches, so
  // the last few chosen by hand stay at the top of every other picker.
  const [recent, setRecent] = useState<string[]>([])

  // The pool the matcher, the picker and the rail all work from: the same
  // watches, with a written name attached for ranking.
  const pool = useMemo<PickerWatch[]>(
    () => candidates.map((c) => ({ ...c, name: [c.brandName, c.nickname].filter(Boolean).join(' ') })),
    [candidates],
  )
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates])

  /** How many photographs of this kind that watch already holds. */
  const heldBy = (watchId: string, kind: ImageKind) => byId.get(watchId)?.photographsByKind[kind] ?? 0

  const accept = (files: FileList | null) => {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'))
    if (!list.length) return
    setPending((current) => [
      ...current,
      ...list.map((file, i) => {
        const m = matchPhoto(file.name, pool)
        return {
          key: `${file.name}-${file.size}-${Date.now()}-${i}`,
          file,
          preview: URL.createObjectURL(file),
          watchIds: m.watchIds,
          // Say where the answer is, not just that there isn't one.
          note: m.watchIds.length ? m.note : m.shortlist.length
            ? `${m.note} The likeliest are first in the picker.`
            : `${m.note} Find it in the rail, or search there.`,
          exact: m.exact,
          shortlist: m.shortlist,
          // A guess from the filename, so that seventy-three of these are not
          // set one at a time. Changeable per row, and in bulk above.
          kind: guessKind(file.name),
          mode: 'add' as ExistingMode,
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

  const setAllModes = (mode: ExistingMode) =>
    setPending((current) => current.map((p) => (p.state === 'saved' ? p : { ...p, mode })))

  // --- assignment ------------------------------------------------------

  const assign = (keys: string[], watchId: string) => {
    const wanted = new Set(keys)
    setPending((current) => current.map((p) => {
      if (!wanted.has(p.key) || p.state === 'saved' || p.watchIds.includes(watchId)) return p
      // Touching a row is as certain as it gets, and it clears the flag the
      // guess was carrying. How the first watch was arrived at is kept: a row
      // that matched on its reference and then had a second watch dragged on
      // should still say so.
      return {
        ...p,
        watchIds: [...p.watchIds, watchId],
        exact: true,
        note: p.watchIds.length ? p.note : 'Chosen by hand',
      }
    }))
    setRecent((current) => [watchId, ...current.filter((x) => x !== watchId)].slice(0, 6))
  }

  const unassign = (key: string, watchId: string) =>
    setPending((current) => current.map((p) => {
      if (p.key !== key) return p
      const watchIds = p.watchIds.filter((id) => id !== watchId)
      // Narrowing a shared reference down by hand is the review the flag was
      // asking for, so it comes off — unless nothing is left.
      return {
        ...p,
        watchIds,
        exact: watchIds.length > 0,
        note: watchIds.length ? p.note : 'No watch chosen.',
      }
    }))

  // --- selection -------------------------------------------------------

  const order = useMemo(() => [...pending].sort((a, b) => TRIAGE(a) - TRIAGE(b)), [pending])
  const selectedSet = useMemo(() => new Set(selected), [selected])

  const toggle = (key: string, shift: boolean) => {
    setSelected((current) => {
      if (shift && lastClicked.current) {
        const from = order.findIndex((p) => p.key === lastClicked.current)
        const to = order.findIndex((p) => p.key === key)
        if (from >= 0 && to >= 0) {
          const span = order.slice(Math.min(from, to), Math.max(from, to) + 1).map((p) => p.key)
          return [...new Set([...current, ...span])]
        }
      }
      return current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
    })
    lastClicked.current = key
  }

  /** What a drag carries: the selection if the dragged row is in it, else that row. */
  const dragPayload = (key: string) => (selectedSet.has(key) ? selected : [key])

  // --- what is going where ---------------------------------------------

  const open = pending.filter((p) => p.state !== 'saved')
  const unplaced = open.filter((p) => p.watchIds.length === 0).length
  const guessed = open.filter((p) => p.watchIds.length > 0 && !p.exact).length
  const ready = open.filter((p) => p.watchIds.length > 0)
  /** One upload per photograph per watch: that is the unit of work. */
  const attachments = ready.reduce((total, p) => total + p.watchIds.length, 0)

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of pending) {
      if (p.state === 'saved') continue
      for (const id of p.watchIds) map.set(id, (map.get(id) ?? 0) + 1)
    }
    return map
  }, [pending])

  const targeted = useMemo(() => {
    const ids = new Set<string>()
    for (const p of pending) if (selectedSet.has(p.key)) for (const id of p.watchIds) ids.add(id)
    return ids
  }, [pending, selectedSet])

  /** Pairs landing on a watch that already holds a photograph of that kind. */
  const occupied = useMemo(() => {
    const pairs: Array<{ key: string; watchId: string; mode: ExistingMode }> = []
    for (const p of pending) {
      if (p.state === 'saved') continue
      for (const id of p.watchIds) {
        if ((byId.get(id)?.photographsByKind[p.kind] ?? 0) > 0) pairs.push({ key: p.key, watchId: id, mode: p.mode })
      }
    }
    return pairs
  }, [pending, byId])
  const occupiedKeys = useMemo(() => new Set(occupied.map((o) => o.key)), [occupied])
  const replacingCount = occupied.filter((o) => o.mode === 'replace').length

  /*
   * Which uploads actually clear what is already there.
   *
   * Replacing is a decision about a watch, not about a file: two photographs
   * of one card are the front and the back, and "replace" means this batch
   * stands in for what was there, not that the back deletes the front. So the
   * first upload for a watch and kind clears the slot and the rest join it —
   * and because the chips say what will happen, that is worked out here,
   * once, rather than inside the save loop where nobody can see it.
   */
  const clears = useMemo(() => {
    const claimed = new Set<string>()
    const pairs = new Set<string>()
    for (const p of pending) {
      if (p.state === 'saved' || p.mode !== 'replace') continue
      for (const id of p.watchIds) {
        const slot = `${id}:${p.kind}`
        if (claimed.has(slot) || (byId.get(id)?.photographsByKind[p.kind] ?? 0) === 0) continue
        claimed.add(slot)
        pairs.add(`${p.key}:${id}`)
      }
    }
    return pairs
  }, [pending, byId])

  // --- saving ----------------------------------------------------------

  const save = async () => {
    setSaving(true)
    let attached = 0
    let failures = 0
    for (const item of ready) {
      update(item.key, { state: 'saving', error: null })
      try {
        const { file, width, height } = await downscaleImage(item.file)
        let failed: string | null = null
        // One upload per watch. The same photograph on three watches is three
        // rows, because each watch owns its own gallery.
        for (const watchId of item.watchIds) {
          const body = new FormData()
          body.set('file', file)
          body.set('watchId', watchId)
          body.set('kind', item.kind)
          if (clears.has(`${item.key}:${watchId}`)) body.set('replace', 'true')
          body.set('width', String(width))
          body.set('height', String(height))
          const response = await fetch('/api/images/upload', { method: 'POST', body })
          const payload = await response.json()
          if (!response.ok) { failed = payload.error ?? 'The upload was refused.'; break }
          attached += 1
        }
        if (failed) { update(item.key, { state: 'failed', error: failed }); failures += 1 }
        else update(item.key, { state: 'saved' })
      } catch {
        update(item.key, { state: 'failed', error: 'Something went wrong reading that file.' })
        failures += 1
      }
    }
    setSaving(false)
    setSelected([])
    if (attached) {
      toast.success(`${attached} photograph${attached === 1 ? '' : 's'} attached`)
      router.refresh()
    }
    if (failures) toast.error(`${failures} could not be attached. They are still listed below.`)
  }

  // --- render ----------------------------------------------------------

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div
          onDragOver={(e) => {
            // Only files light this up. A photograph dragged towards the rail
            // passes over the page and must not make it flash.
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            setOverDropZone(true)
          }}
          onDragLeave={() => setOverDropZone(false)}
          onDrop={(e) => { e.preventDefault(); setOverDropZone(false); accept(e.dataTransfer.files) }}
          className={cn(
            'flex flex-col items-center gap-3 rounded-md border border-dashed text-center transition-colors',
            pending.length ? 'px-6 py-6' : 'px-6 py-12',
            overDropZone ? 'border-teal-500 bg-teal-100/50' : 'border-line-subtle bg-surface-subtle',
          )}
        >
          <ImagePlus className="h-6 w-6 text-content-secondary" aria-hidden />
          <div>
            <p className="text-body font-semibold text-content-primary">Drop photographs here</p>
            {pending.length === 0 && (
              <p className="mt-1 text-small text-content-secondary">
                Named with the reference, the serial or the stock number —{' '}
                <span className="tabular-nums">5167R.png</span>,{' '}
                <span className="tabular-nums">466787F0.jpg</span> or{' '}
                <span className="tabular-nums">IMG_4821_1378.jpg</span>. A reference several watches share
                goes to all of them.
              </p>
            )}
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
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle px-5 py-3">
              <p className="text-small text-content-secondary">
                {pending.length} photograph{pending.length === 1 ? '' : 's'}
                {attachments !== ready.length && (
                  <>{' → '}<span className="font-semibold text-content-primary">{attachments} attachments</span></>
                )}
                {unplaced > 0 && (
                  <>{' · '}<span className="font-semibold text-state-warning">{unplaced} need a watch</span></>
                )}
                {guessed > 0 && (
                  <>{' · '}<span className="font-semibold text-state-warning">{guessed} to check</span></>
                )}
                {replacingCount > 0 && (
                  <>{' · '}<span className="font-semibold text-content-primary">{replacingCount} replacing</span></>
                )}
              </p>
              <div className="flex items-center gap-2">
                {/* Setting the kind seventy-three times is the thing that makes
                    a batch tool not a batch tool. */}
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
                <Button onClick={save} disabled={saving || attachments === 0}>
                  {saving ? 'Saving…' : `Attach ${attachments}`}
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-b border-line-subtle px-5 py-2 text-caption text-content-secondary">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label="Select every photograph"
                  checked={open.length > 0 && selected.length === open.length}
                  ref={(el) => { if (el) el.indeterminate = selected.length > 0 && selected.length < open.length }}
                  onChange={(e) => setSelected(e.target.checked ? open.map((p) => p.key) : [])}
                  className="h-3.5 w-3.5 accent-teal-500"
                />
                {selected.length > 0 ? `${selected.length} selected` : 'Select all'}
              </label>
              {unplaced > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected(open.filter((p) => p.watchIds.length === 0).map((p) => p.key))}
                  className="font-semibold text-content-accent hover:underline"
                >
                  Select the {unplaced} without a watch
                </button>
              )}
              {selected.length > 0 && (
                <span className="text-content-muted">
                  Drag them onto a watch in the rail, or press ＋ beside it.
                </span>
              )}
            </div>

            {/*
              The watches that already have one.

              Added photographs sort after the ones already there, and the
              table, the gallery and the shop all show the first — so adding to
              a watch that already has a photograph changes nothing anybody can
              see. The batch is asked rather than assumed, here, once, before
              anything is written.
            */}
            {occupied.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle bg-surface-subtle px-5 py-3">
                <p className="text-small text-content-secondary">
                  <span className="font-semibold text-content-primary">{occupied.length}</span>
                  {occupied.length === 1 ? ' of these goes' : ' of these go'} to a watch that already has a
                  photograph of that kind.
                </p>
                <div className="flex items-center gap-1 rounded-sm border border-line-subtle bg-surface-raised p-0.5">
                  {([['add', 'Keep both'], ['replace', 'Replace the old one']] as const).map(([mode, text]) => {
                    const on = occupied.every((o) => o.mode === mode)
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setAllModes(mode)}
                        aria-pressed={on}
                        className={cn(
                          'rounded-[3px] px-3 py-1.5 text-caption font-semibold transition-colors',
                          on ? 'bg-teal-500 text-white' : 'text-content-secondary hover:bg-surface-subtle hover:text-content-primary',
                        )}
                      >
                        {text}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* The rules between rows are drawn per row rather than with
                `divide-y`, because `divide-{color}` sets border-color on every
                side at a specificity the row's own left-edge accent cannot
                beat — and that accent is how an unplaced row announces itself. */}
            <ul>
              {order.map((p) => {
                const guess = p.watchIds.length > 0 && !p.exact && p.state !== 'saved'
                const bare = p.watchIds.length === 0 && p.state !== 'saved'
                const isSelected = selectedSet.has(p.key)
                return (
                  <li
                    key={p.key}
                    draggable={p.state === 'ready'}
                    onDragStart={(e) => {
                      const keys = dragPayload(p.key)
                      setDragging(keys)
                      e.dataTransfer.effectAllowed = 'copy'
                      e.dataTransfer.setData('text/plain', keys.join(','))
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={cn(
                      'flex items-start gap-3 border-l-2 border-t border-t-line-subtle px-5 py-3 first:border-t-0',
                      p.state === 'ready' && 'cursor-grab active:cursor-grabbing',
                      bare ? 'border-l-state-warning bg-state-warning/[0.06]'
                        : guess ? 'border-l-state-warning/60' : 'border-l-transparent',
                      isSelected && 'bg-teal-100/40',
                      dragging?.includes(p.key) && 'opacity-50',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      aria-label={`Select ${p.file.name}`}
                      disabled={p.state === 'saved'}
                      onChange={() => {}}
                      onClick={(e) => toggle(p.key, e.shiftKey)}
                      className="mt-5 h-3.5 w-3.5 shrink-0 accent-teal-500"
                    />

                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.preview}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-sm border border-line-subtle object-cover"
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-small font-semibold text-content-primary">{p.file.name}</p>
                          <p className={cn(
                            'truncate text-caption',
                            p.state === 'failed' || bare || guess ? 'text-state-warning' : 'text-content-secondary',
                          )}>
                            {p.state === 'failed' ? p.error : p.note}
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <select
                            value={p.kind}
                            aria-label={`Kind for ${p.file.name}`}
                            onChange={(e) => update(p.key, { kind: e.target.value as ImageKind })}
                            disabled={p.state === 'saved'}
                            className="h-8 cursor-pointer appearance-none rounded-sm border border-line-subtle bg-surface-raised pl-2.5 pr-3 text-caption text-content-primary outline-none focus:border-teal-500"
                          >
                            {IMAGE_KINDS.map((k) => <option key={k} value={k}>{IMAGE_KIND_LABELS[k]}</option>)}
                          </select>

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
                      </div>

                      {/* Where it is going. A list, because it can be more than
                          one — which is the thing a dropdown could not say. */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {p.watchIds.map((id) => {
                          const watch = byId.get(id)
                          const already = heldBy(id, p.kind)
                          const clearing = clears.has(`${p.key}:${id}`)
                          return (
                            <span
                              key={id}
                              className={cn(
                                'inline-flex h-6 max-w-full items-center gap-1 rounded-full border pl-2 text-caption',
                                p.state === 'saved' ? 'pr-2' : 'pr-1',
                                clearing
                                  ? 'border-line-strong bg-surface-subtle text-content-primary'
                                  : 'border-line-subtle bg-surface-raised text-content-secondary',
                              )}
                            >
                              <span className="truncate">
                                <span className="tabular-nums">{watch?.stockNo}</span>
                                {' · '}
                                <span className="font-semibold text-content-primary">{watch?.reference}</span>
                                {already > 0 && (
                                  <span className={clearing ? 'font-semibold text-content-primary' : 'text-content-muted'}>
                                    {clearing ? ` · replacing ${already}` : ` · ${already} there`}
                                  </span>
                                )}
                              </span>
                              {p.state !== 'saved' && (
                                <button
                                  type="button"
                                  onClick={() => unassign(p.key, id)}
                                  aria-label={`Do not attach ${p.file.name} to stock ${watch?.stockNo}`}
                                  className="rounded-full p-0.5 text-content-muted hover:bg-surface-subtle hover:text-state-danger"
                                >
                                  <X className="h-3 w-3" aria-hidden />
                                </button>
                              )}
                            </span>
                          )
                        })}

                        {p.state !== 'saved' && (
                          <WatchPicker
                            variant="add"
                            watches={pool}
                            assigned={p.watchIds}
                            suggested={p.shortlist}
                            recent={recent}
                            label={`Add a watch for ${p.file.name}`}
                            flagged={bare}
                            onChange={(id) => (p.watchIds.includes(id) ? unassign(p.key, id) : assign([p.key], id))}
                          />
                        )}

                        {p.state !== 'saved' && occupiedKeys.has(p.key) && (
                          <select
                            value={p.mode}
                            aria-label={`What to do about the photographs ${p.file.name} would join`}
                            onChange={(e) => update(p.key, { mode: e.target.value as ExistingMode })}
                            className={cn(
                              'h-6 cursor-pointer appearance-none rounded-full border bg-surface-raised px-2 text-caption outline-none focus:border-teal-500',
                              p.mode === 'replace'
                                ? 'border-line-strong font-semibold text-content-primary'
                                : 'border-line-subtle text-content-secondary',
                            )}
                          >
                            <option value="add">Keep both</option>
                            <option value="replace">Replace</option>
                          </select>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>

          {/* Below xl the rail would stack under seventy-three rows, where
              nothing could be dragged to it. The per-row picker does the same
              job there, so the rail simply stands down. */}
          <StockRail
            className="hidden max-h-[calc(100vh-2rem)] xl:sticky xl:top-4 xl:flex"
            watches={pool}
            counts={counts}
            targeted={targeted}
            selectionCount={selected.length}
            dragging={dragging !== null}
            onAssign={(watchId) => {
              const keys = dragging ?? selected
              if (keys.length) assign(keys, watchId)
              setDragging(null)
            }}
          />
        </div>
      )}
    </div>
  )
}
