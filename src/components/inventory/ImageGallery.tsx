'use client'
import { useCallback, useRef, useState } from 'react'
import { Camera, CreditCard, Loader2, Trash2, Upload, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, ConfirmDialog, useToast } from '@/components/ui'
import { downscaleImage } from '@/lib/downscale'
import { IMAGE_KIND_LABELS, type ImageKind } from '@/lib/enums'

export interface GalleryImage {
  id: string
  kind: ImageKind
  caption: string | null
  byteSize: number
}

/**
 * Photographs of a watch and its warranty card.
 *
 * Uploads are downscaled in the browser first, so a 10 MB phone photo becomes
 * a few hundred kilobytes before it leaves the device. Files are grouped by
 * kind because "is the card present" is a different question from "what does
 * it look like", and both get asked when a watch is being valued.
 */
export function ImageGallery({ watchId, initial, canEdit }: {
  watchId: string
  initial: GalleryImage[]
  canEdit: boolean
}) {
  const toast = useToast()
  const [images, setImages] = useState(initial)
  const [uploading, setUploading] = useState<ImageKind | null>(null)
  const [dragging, setDragging] = useState<ImageKind | null>(null)
  const [deleting, setDeleting] = useState<GalleryImage | null>(null)
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})

  const upload = useCallback(async (files: FileList | File[], kind: ImageKind) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (list.length === 0) {
      toast.error('That file is not an image', 'JPEG, PNG and WebP are supported.')
      return
    }
    setUploading(kind)
    for (const original of list) {
      try {
        const { file, width, height } = await downscaleImage(original)
        const body = new FormData()
        body.set('file', file)
        body.set('watchId', watchId)
        body.set('kind', kind)
        body.set('width', String(width))
        body.set('height', String(height))
        const response = await fetch('/api/images/upload', { method: 'POST', body })
        const payload = await response.json()
        if (!response.ok) {
          toast.error('Upload failed', payload.error)
          continue
        }
        setImages((current) => [...current, payload.image as GalleryImage])
      } catch {
        toast.error('Upload failed', 'Something went wrong reading that file.')
      }
    }
    setUploading(null)
  }, [watchId, toast])

  const confirmDelete = async () => {
    if (!deleting) return
    const response = await fetch(`/api/images/upload?id=${deleting.id}`, { method: 'DELETE' })
    if (response.ok) {
      setImages((current) => current.filter((image) => image.id !== deleting.id))
      toast.success('Image removed')
    } else {
      toast.error('Could not remove that image')
    }
    setDeleting(null)
  }

  const sections: Array<{ kind: ImageKind; icon: typeof Camera; hint: string }> = [
    { kind: 'WATCH', icon: Camera, hint: 'Dial, caseback, bracelet — whatever a buyer would ask to see.' },
    { kind: 'CARD', icon: CreditCard, hint: 'Warranty card, receipt or certificate.' },
  ]

  return (
    <>
      <div className="flex flex-col gap-6">
        {sections.map(({ kind, icon: Icon, hint }) => {
          const forKind = images.filter((image) => image.kind === kind)
          const busy = uploading === kind
          return (
            <section key={kind} aria-label={IMAGE_KIND_LABELS[kind]}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-caption font-semibold text-content-secondary">
                  {IMAGE_KIND_LABELS[kind]}
                  {forKind.length > 0 && <span className="ml-1.5 text-content-primary">({forKind.length})</span>}
                </h3>
                {canEdit && forKind.length > 0 && (
                  <Button
                    size="sm" variant="ghost" loading={busy}
                    icon={<Upload className="h-3.5 w-3.5" />}
                    onClick={() => inputs.current[kind]?.click()}
                  >
                    Add
                  </Button>
                )}
              </div>

              {canEdit && (
                <input
                  ref={(element) => { inputs.current[kind] = element }}
                  type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
                  onChange={(event) => {
                    if (event.target.files?.length) void upload(event.target.files, kind)
                    event.target.value = ''
                  }}
                />
              )}

              {forKind.length === 0 ? (
                <div
                  onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDragging(kind) } }}
                  onDragLeave={() => setDragging(null)}
                  onDrop={(e) => {
                    if (!canEdit) return
                    e.preventDefault()
                    setDragging(null)
                    if (e.dataTransfer.files?.length) void upload(e.dataTransfer.files, kind)
                  }}
                  className={cn(
                    'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-center transition-colors',
                    dragging === kind ? 'border-teal-500 bg-teal-100' : 'border-line-subtle bg-surface-subtle',
                  )}
                >
                  {busy
                    ? <Loader2 className="h-6 w-6 animate-spin text-content-secondary" aria-hidden />
                    : <Icon className="h-6 w-6 text-content-secondary" aria-hidden />}
                  <p className="text-small font-medium text-content-secondary">
                    {busy ? 'Uploading…' : `No ${IMAGE_KIND_LABELS[kind].toLowerCase()} images yet`}
                  </p>
                  {canEdit && !busy && (
                    <>
                      <p className="max-w-xs text-caption text-content-secondary">{hint}</p>
                      <Button size="sm" variant="secondary" className="mt-1"
                        onClick={() => inputs.current[kind]?.click()}>
                        Choose or drag files
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {forKind.map((image) => (
                    <li key={image.id} className="group relative aspect-square overflow-hidden rounded-md border border-line-subtle bg-surface-subtle">
                      {/* Served through an authenticated route, so a plain
                          <img> is used rather than next/image. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/images/${image.id}`}
                        alt={image.caption ?? `${IMAGE_KIND_LABELS[image.kind]} image`}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setDeleting(image)}
                          aria-label="Remove this image"
                          className="absolute right-1 top-1 rounded-sm bg-navy-900/70 p-1.5 text-white opacity-0 transition-opacity hover:bg-state-danger focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </li>
                  ))}
                  {busy && (
                    <li className="flex aspect-square items-center justify-center rounded-md border border-dashed border-line-subtle">
                      <Loader2 className="h-5 w-5 animate-spin text-content-secondary" aria-hidden />
                    </li>
                  )}
                </ul>
              )}
            </section>
          )
        })}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Remove this image?"
        message="It will be deleted permanently. The change is recorded in the watch's history."
        confirmLabel="Remove"
      />
    </>
  )
}

export { X }
