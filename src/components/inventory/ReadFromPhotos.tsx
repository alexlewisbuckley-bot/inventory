'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Check, Loader2, RotateCcw, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { downscaleImage, isUploadableImage } from '@/lib/downscale'
import { IMAGE_KIND_LABELS, type ImageKind } from '@/lib/enums'
import type { IntakeReadResponse, IntakeReading } from '@/app/api/intake/read/route'

/** A photograph held back for the watch that does not exist yet. */
export interface HeldPhoto {
  file: File
  kind: ImageKind
  /** For the preview, revoked when this component goes away. */
  url: string
}

/**
 * Read at a higher resolution than it is filed at.
 *
 * The gallery stores 1600px because that is what a photograph of a watch
 * needs to look right. A serial is sixteen characters perhaps two hundred
 * pixels wide in the frame, and at 1600 the difference between an 8 and a B
 * is a couple of pixels. The reading copy is made larger and thrown away
 * afterwards; what gets filed is still the ordinary one.
 */
const READ_EDGE = 2000

type Phase = 'idle' | 'reading' | 'done' | 'failed'

/**
 * Start the form from photographs of the watch and its card.
 *
 * The reference and the serial are already printed on the card in somebody's
 * hand. Typing them into this form from a photograph on the same screen is
 * transcription, and the serial is the one field nobody can check afterwards
 * — it is what identifies the watch to an insurer and to the register.
 *
 * What comes back fills the form and stops. Nothing is saved here: the cost,
 * the supplier and where the watch is going are not in any photograph, and
 * the person booking it in is looking at every read field before they submit.
 */
export function ReadFromPhotos({ enabled, onReading, onPhotos }: {
  enabled: boolean
  onReading: (reading: IntakeReading) => void
  onPhotos: (photos: HeldPhoto[]) => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [photos, setPhotos] = useState<HeldPhoto[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [unreadable, setUnreadable] = useState<string | null>(null)
  const [newBrand, setNewBrand] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)

  // The previews are object URLs, and a tab that books in twenty watches
  // leaks twenty of them otherwise.
  const urls = useRef<string[]>([])
  useEffect(() => () => { urls.current.forEach((url) => URL.revokeObjectURL(url)) }, [])

  const read = useCallback(async (files: File[]) => {
    const images = files.filter(isUploadableImage)
    if (images.length === 0) {
      setNote('Those were not photographs. Drop a picture of the watch and one of its card.')
      setPhase('failed')
      return
    }

    setPhase('reading')
    setNote(null)
    setUnreadable(null)
    setNewBrand(null)

    try {
      const body = new FormData()
      for (const image of images) {
        const { file } = await downscaleImage(image, { maxEdge: READ_EDGE, quality: 0.9 })
        body.append('files', file)
      }

      const response = await fetch('/api/intake/read', { method: 'POST', body })
      const payload = (await response.json()) as IntakeReadResponse & { error?: string }

      if (!response.ok) {
        setNote(payload.error ?? 'The reading was refused.')
        setPhase('failed')
        return
      }
      if (!payload.reading) {
        setNote(payload.configured
          ? `They could not be read — ${payload.error ?? 'nothing came back'}. Fill the form in yourself.`
          : 'Reading photographs is not switched on for this deployment. Fill the form in yourself.')
        setPhase('failed')
        return
      }

      const reading = payload.reading
      // Kept in step: the reading returns one kind per image in the order
      // they were sent, which is the order they are held in here.
      const held = images.map((file, index) => {
        const url = URL.createObjectURL(file)
        urls.current.push(url)
        return { file, kind: reading.imageKinds[index] ?? 'WATCH', url }
      })
      setPhotos(held)
      onPhotos(held)
      onReading(reading)

      setUnreadable(reading.unreadable)
      // Read but not one of ours. Said plainly, because the brand box below
      // will be empty and the reason is three words long.
      if (reading.brand && !reading.brandId) setNewBrand(reading.brand)
      setNote(summarise(reading))
      setPhase('done')
    } catch {
      setNote('Something went wrong sending those photographs.')
      setPhase('failed')
    }
  }, [onPhotos, onReading])

  const reset = () => {
    setPhotos([])
    onPhotos([])
    setPhase('idle')
    setNote(null)
    setUnreadable(null)
    setNewBrand(null)
  }

  if (!enabled) return null

  return (
    <div className="mb-6">
      <input
        ref={input}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          // Cleared so the same file picked twice still fires a change.
          event.target.value = ''
          if (files.length > 0) void read(files)
        }}
      />

      <div
        onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const files = Array.from(event.dataTransfer.files)
          if (files.length > 0) void read(files)
        }}
        className={cn(
          'rounded-lg border border-dashed px-4 py-4 transition-colors',
          dragging ? 'border-content-accent bg-surface-subtle' : 'border-line-strong bg-surface-subtle/40',
        )}
      >
        {phase === 'reading' ? (
          <p className="flex items-center justify-center gap-2 py-2 text-small text-content-secondary">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Reading the photographs…
          </p>
        ) : photos.length > 0 ? (
          <div className="flex flex-wrap items-start gap-3">
            {photos.map((photo) => (
              <figure key={photo.url} className="w-24">
                {/* The gallery's own component wants a saved image; these are
                    not saved yet, so a plain tag on an object URL. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt=""
                  className="h-24 w-24 rounded-md border border-line-subtle object-cover"
                />
                <figcaption className="mt-1 text-center text-micro text-content-muted">
                  {IMAGE_KIND_LABELS[photo.kind]}
                </figcaption>
              </figure>
            ))}
            <div className="flex-1 min-w-[12rem] space-y-1.5">
              {note && (
                <p className="flex items-start gap-1.5 text-small text-content-primary">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-state-success" aria-hidden />
                  <span>{note}</span>
                </p>
              )}
              {/* Said out loud, because a field left blank on purpose and a
                  field nobody could read look identical in a form. */}
              {unreadable && (
                <p className="text-small text-state-warning">{unreadable}</p>
              )}
              {newBrand && (
                <p className="text-small text-content-secondary">
                  {newBrand} is not in your brand list — add it in the box below.
                </p>
              )}
              <p className="text-small text-content-muted">
                Check what it read, then add the cost and the rest. These photographs
                are attached when you save.
              </p>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1.5 text-small font-bold text-content-accent hover:underline"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Start again
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
            <Camera className="h-4 w-4 text-content-muted" aria-hidden />
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="text-small font-bold text-content-accent hover:underline"
            >
              Photograph the watch and its card
            </button>
            <span className="text-small text-content-secondary">
              to fill in the reference and serial, or drop the pictures here.
            </span>
          </div>
        )}
      </div>

      {phase === 'failed' && note && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-small text-state-danger">
          <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{note}</span>
        </p>
      )}
    </div>
  )
}

/**
 * What it found, named rather than counted.
 *
 * "Read 6 fields" tells somebody nothing they can check. The reference and
 * the serial are the two worth confirming at a glance, so they are the two
 * that get said.
 */
function summarise(reading: IntakeReading): string {
  const found: string[] = []
  if (reading.model) found.push(`reference ${reading.model}`)
  if (reading.serial) found.push(`serial ${reading.serial}`)
  if (found.length === 0) return 'Nothing could be read from these — fill the form in yourself.'
  const rest = [reading.brand, reading.modelName].filter(Boolean).join(' ')
  return `Read ${found.join(' and ')}${rest ? ` for the ${rest}` : ''}.`
}
