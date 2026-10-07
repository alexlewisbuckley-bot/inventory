'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CreditCard, Handshake, Library, Loader2, Trash2, Upload, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, ConfirmDialog, Modal, useToast } from '@/components/ui'
import { downscaleImage, isUploadableImage } from '@/lib/downscale'
import { useLibraryImageAction } from '@/app/actions/watches'
import { IMAGE_KIND_LABELS, type ImageKind } from '@/lib/enums'

/** One photograph on the shelf for this watch's reference. */
interface LibraryImage {
  id: string
  label: string
  byteSize: number
}

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

  // The reference library: every photograph banked against this watch's
  // model, whichever watch it was taken for. Fetched when the picker opens
  // rather than with the page, because most visits never ask for it.
  const [library, setLibrary] = useState<{ reference: string; images: LibraryImage[] } | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [taking, setTaking] = useState<string | null>(null)
  const [shelving, setShelving] = useState<LibraryImage | null>(null)

  const loadLibrary = useCallback(async () => {
    try {
      const response = await fetch(`/api/reference-images?watchId=${watchId}`)
      const payload = await response.json()
      if (response.ok) setLibrary(payload)
      return response.ok ? null : (payload.error as string)
    } catch {
      return 'Something went wrong.'
    }
  }, [watchId])

  /*
   * A watch with no photograph asks the library on sight.
   *
   * It was behind a button, and a button is the wrong shape for this: the
   * person looking at an empty gallery does not know whether anything is on
   * the shelf, so "Use a stock photograph" reads as a chore to be gone
   * through rather than an answer waiting. Shown instead, with the pictures
   * themselves, the empty state answers the question it raises.
   */
  const needsPhotographs = canEdit && !images.some((image) => image.kind === 'WATCH')
  useEffect(() => {
    if (!needsPhotographs || library) return
    void loadLibrary()
  }, [needsPhotographs, library, loadLibrary])

  const removeFromLibrary = async () => {
    if (!shelving) return
    const response = await fetch(`/api/reference-images/${shelving.id}`, { method: 'DELETE' })
    if (response.ok) {
      setLibrary((current) => current && {
        ...current,
        images: current.images.filter((image) => image.id !== shelving.id),
      })
      toast.success('Taken off the shelf', 'Watches that already use it keep their copy.')
    } else {
      toast.error('Could not remove that photograph')
    }
    setShelving(null)
  }

  const browse = async () => {
    setBrowsing(true)
    if (library) return
    const error = await loadLibrary()
    if (error) toast.error('Could not open the library', error)
  }

  const take = async (referenceImageId: string) => {
    setTaking(referenceImageId)
    const result = await useLibraryImageAction({ watchId, referenceImageId })
    setTaking(null)
    if (!result.ok) { toast.error('Could not add that photograph', result.message); return }
    // Added the way an upload is added, because to this watch it is simply
    // its photograph: nothing in the gallery says where it came from.
    setImages((current) => [...current, {
      id: result.id!, kind: 'WATCH' as ImageKind, caption: null, byteSize: 0,
    }])
    setBrowsing(false)
    toast.success('Photograph added')
  }

  const upload = useCallback(async (files: FileList | File[], kind: ImageKind) => {
    const list = Array.from(files).filter(isUploadableImage)
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

  // The hint on each of these says who sees it, because that is the only
  // thing somebody uploading needs to decide and the only thing that cannot
  // be undone by moving a file afterwards.
  const sections: Array<{ kind: ImageKind; icon: typeof Camera; hint: string }> = [
    {
      kind: 'WATCH',
      icon: Camera,
      hint: 'Dial, caseback, bracelet — whatever a buyer would ask to see. '
        + 'These are the ones published: the website, the resellers, Shopify.',
    },
    {
      kind: 'TRADE',
      icon: Handshake,
      hint: 'The same watch, shot for the trade. Dealers signed in to the catalogue '
        + 'see these, and so does this system — the website and the resellers never do.',
    },
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
                  <div className="flex items-center gap-1">
                    {kind === 'WATCH' && (
                      <Button
                        size="sm" variant="ghost"
                        icon={<Library className="h-3.5 w-3.5" />}
                        onClick={browse}
                      >
                        Library
                      </Button>
                    )}
                    <Button
                      size="sm" variant="ghost" loading={busy}
                      icon={<Upload className="h-3.5 w-3.5" />}
                      onClick={() => inputs.current[kind]?.click()}
                    >
                      Add
                    </Button>
                  </div>
                )}
              </div>

              {canEdit && (
                <input
                  ref={(element) => { inputs.current[kind] = element }}
                  type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" multiple hidden
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

                      {/* The matches, shown rather than mentioned.

                          Only photographs of the watch: a warranty card
                          carries a serial, a date and a dealer's stamp, so it
                          belongs to the one watch it was issued for and there
                          is no library door on that section at all. */}
                      {kind === 'WATCH' && library && library.images.length > 0 && (
                        <div className="mt-2 w-full max-w-md">
                          <p className="mb-2 text-caption font-semibold text-content-primary">
                            {library.images.length} photograph{library.images.length === 1 ? '' : 's'} of{' '}
                            {library.reference} already — use one?
                          </p>
                          <ul className="flex flex-wrap justify-center gap-2">
                            {library.images.slice(0, 4).map((image) => (
                              <li key={image.id}>
                                <button
                                  type="button"
                                  onClick={() => take(image.id)}
                                  disabled={taking !== null}
                                  title={`Use this photograph of ${library.reference}`}
                                  className="relative block h-20 w-20 overflow-hidden rounded-md border border-line-subtle bg-surface-raised outline-none transition-colors hover:border-teal-500 focus-visible:border-teal-500 disabled:opacity-60"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={`/api/reference-images/${image.id}`}
                                    alt={`${image.label} stock photograph`}
                                    loading="lazy"
                                    className="h-full w-full object-cover"
                                  />
                                  {taking === image.id && (
                                    <span className="absolute inset-0 flex items-center justify-center bg-surface-overlay/70">
                                      <Loader2 className="h-4 w-4 animate-spin text-content-secondary" aria-hidden />
                                    </span>
                                  )}
                                </button>
                              </li>
                            ))}
                            {library.images.length > 4 && (
                              <li>
                                <button
                                  type="button"
                                  onClick={browse}
                                  className="h-20 w-20 rounded-md border border-dashed border-line-subtle text-caption font-semibold text-content-secondary hover:border-teal-500 hover:text-content-accent"
                                >
                                  +{library.images.length - 4} more
                                </button>
                              </li>
                            )}
                          </ul>
                        </div>
                      )}

                      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                        <Button size="sm" variant="secondary"
                          onClick={() => inputs.current[kind]?.click()}>
                          Choose or drag files
                        </Button>
                        {kind === 'WATCH' && library && library.images.length === 0 && (
                          <span className="text-caption text-content-muted">
                            Nothing photographed for {library.reference} yet
                          </span>
                        )}
                      </div>
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

      <Modal
        open={browsing}
        onClose={() => setBrowsing(false)}
        title={library ? `Photographs of ${library.reference}` : 'Photograph library'}
        description="Taken for this model before, on this watch or another. Choosing one puts a copy on this watch."
        size="lg"
      >
        {!library ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-content-secondary" aria-hidden />
          </div>
        ) : library.images.length === 0 ? (
          <p className="py-10 text-center text-small text-content-secondary">
            Nothing has been photographed for this reference yet. Upload one and it goes on the shelf for
            the next watch of this model.
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {library.images.map((image) => (
              <li key={image.id} className="group relative">
                <button
                  type="button"
                  onClick={() => take(image.id)}
                  disabled={taking !== null}
                  className="relative block aspect-square w-full overflow-hidden rounded-md border border-line-subtle bg-surface-subtle outline-none transition-colors hover:border-teal-500 focus-visible:border-teal-500 disabled:opacity-60"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/reference-images/${image.id}`}
                    alt={`${image.label} stock photograph`}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  {taking === image.id && (
                    <span className="absolute inset-0 flex items-center justify-center bg-surface-overlay/70">
                      <Loader2 className="h-5 w-5 animate-spin text-content-secondary" aria-hidden />
                    </span>
                  )}
                </button>
                {/* The shelf is shared, so it has to be tidyable from here —
                    otherwise a batch shot on the wrong background goes on
                    being offered to every watch of the reference forever. */}
                <button
                  type="button"
                  onClick={() => setShelving(image)}
                  aria-label={`Take this ${image.label} photograph off the shelf`}
                  className="absolute right-1 top-1 rounded-sm bg-navy-900/70 p-1.5 text-white opacity-0 transition-opacity hover:bg-state-danger focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <ConfirmDialog
        open={shelving !== null}
        onCancel={() => setShelving(null)}
        onConfirm={removeFromLibrary}
        title="Take this off the shelf?"
        message={`It will stop being offered to watches with reference ${library?.reference ?? ''}. Watches already using it keep their own copy — nothing in a gallery changes.`}
        confirmLabel="Remove"
      />

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
