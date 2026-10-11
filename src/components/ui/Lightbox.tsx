'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Expand, X } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface LightboxImage {
  /** Where the full-size picture lives. */
  src: string
  /** What it is, for somebody who cannot see it. */
  alt: string
  /** A line under the picture: which kind, whose watch, what it cost. */
  caption?: string | null
}

/**
 * A photograph, big enough to decide something by.
 *
 * Every picture in this system is shown as a thumbnail a hundred-odd pixels
 * across, which is enough to recognise a watch and nowhere near enough to do
 * the thing the photograph is for. A trade shot exists so somebody can read a
 * date off a card, see whether a bracelet is stretched, or count the links;
 * a warranty card is a photograph of small print. At three centimetres square
 * all of that is a rumour, and the only way to look properly was to open the
 * image route in another tab — which works, and which nobody thinks to do,
 * so in practice the pictures were decorative.
 *
 * One viewer for all of them rather than one per screen. It takes the set it
 * is sitting in, not a single image, because the question is never "what does
 * this one look like" but "what does this watch look like", and paging between
 * six photographs is the whole of the task.
 *
 * Deliberately plain: no zoom, no pan, no gestures. The image is drawn as
 * large as the window allows and never cropped — `object-contain`, because a
 * viewer that crops is a viewer that hides the edge of the card you opened it
 * to read.
 */
export function Lightbox({ images, index, onIndex, onClose }: {
  images: LightboxImage[]
  /** Which one is open. */
  index: number
  /** Paging, when there is more than one. */
  onIndex: (next: number) => void
  onClose: () => void
}) {
  const count = images.length
  const image = images[index]

  const step = useCallback((by: number) => {
    if (count < 2) return
    // Wraps. A set of photographs has no first or last in any meaningful
    // sense, and stopping dead at the end is a control that stops working.
    onIndex((index + by + count) % count)
  }, [count, index, onIndex])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key === 'ArrowRight') { event.preventDefault(); step(1); return }
      if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1) }
    }
    document.addEventListener('keydown', onKey)
    // The page behind must not scroll under the overlay: a flick on a phone
    // would otherwise move the list while the picture stays put.
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose, step])

  if (!image || typeof document === 'undefined') return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.alt}
      // Clicking the backdrop closes. The picture and the controls stop the
      // click, so dragging a selection across the image does not dismiss it.
      onClick={onClose}
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-navy-900/90 p-4 backdrop-blur-sm sm:p-8"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <X className="h-5 w-5" aria-hidden />
      </button>

      {count > 1 && (
        <>
          <Step side="left" onClick={() => step(-1)} />
          <Step side="right" onClick={() => step(1)} />
        </>
      )}

      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <img
        src={image.src}
        alt={image.alt}
        onClick={(event) => event.stopPropagation()}
        className="max-h-full min-h-0 w-auto max-w-full flex-1 object-contain"
      />

      {(image.caption || count > 1) && (
        <p
          onClick={(event) => event.stopPropagation()}
          className="mt-3 shrink-0 text-center text-caption text-white/70"
        >
          {image.caption}
          {image.caption && count > 1 && <span className="px-2">·</span>}
          {count > 1 && <span className="tabular-nums">{index + 1} of {count}</span>}
        </p>
      )}
    </div>,
    document.body,
  )
}

function Step({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); onClick() }}
      aria-label={side === 'left' ? 'Previous photograph' : 'Next photograph'}
      className={cn(
        'absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20',
        side === 'left' ? 'left-2 sm:left-4' : 'right-2 sm:right-4',
      )}
    >
      <Icon className="h-6 w-6" aria-hidden />
    </button>
  )
}

/**
 * The state a screen needs to show one, kept in one place.
 *
 * Every consumer of this was about to grow the same two `useState`s and the
 * same "open at this one" handler, and the third copy is where they start
 * disagreeing about what closing means.
 */
export function useLightbox() {
  const [at, setAt] = useState<number | null>(null)
  return {
    /** Which photograph is open, or null for none. */
    at,
    open: (index: number) => setAt(index),
    close: () => setAt(null),
    move: (next: number) => setAt(next),
  }
}

/**
 * The props a thumbnail needs to become a way in.
 *
 * Spread onto the element that wraps the picture. A thumbnail that opens
 * something is a button, and typing it as one here is what stops each screen
 * reinventing the keyboard half and forgetting it.
 */
export function openerProps(onOpen: () => void, label = 'Enlarge this photograph') {
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': label,
    onClick: onOpen,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onOpen()
    },
  }
}

/**
 * A thumbnail that opens itself.
 *
 * Most pictures in this system stand alone — one shot on a card, one in a
 * table row — and lifting state out of each of those screens to hold "which
 * image is open" buys nothing when the answer is always "that one". This is
 * the whole feature in one element.
 */
export function Zoomable({ src, alt, caption, className, loading = 'lazy' }: {
  src: string
  alt: string
  caption?: string | null
  className?: string
  loading?: 'lazy' | 'eager'
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        {...openerProps(() => setOpen(true), alt ? `Enlarge: ${alt}` : 'Enlarge this photograph')}
        src={src}
        alt={alt}
        loading={loading}
        decoding="async"
        className={cn('cursor-zoom-in', className)}
      />
      {open && (
        <Lightbox
          images={[{ src, alt, caption }]}
          index={0}
          onIndex={() => {}}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/**
 * The same, for a picture already inside something clickable.
 *
 * A stock card is a link to the watch, and taking that click away to show a
 * bigger version of a picture they can see would be a worse card. So the way
 * in is its own small control in the corner, which appears on hover and on
 * keyboard focus and swallows the click before the card gets it.
 */
export function ZoomButton({ src, alt, caption, className }: {
  src: string
  alt: string
  caption?: string | null
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label={alt ? `Enlarge: ${alt}` : 'Enlarge this photograph'}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(true) }}
        className={cn(
          'absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-sm bg-navy-900/60 text-white opacity-0 transition-opacity hover:bg-navy-900/80 focus-visible:opacity-100 group-hover:opacity-100',
          className,
        )}
      >
        <Expand className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <Lightbox
          images={[{ src, alt, caption }]}
          index={0}
          onIndex={() => {}}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
