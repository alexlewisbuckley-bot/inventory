'use client'
import { useState } from 'react'
import { Check, Send } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { postFilename, whatsappPost, type PostableWatch } from '@/lib/whatsapp-post'

/**
 * Put a watch into a dealer group, in one click.
 *
 * This is a speed tool. Somebody is working a list, sees a piece worth
 * putting out, and wants it in the group before the thought has finished —
 * so the measure of this component is clicks, and the first version failed
 * it: a panel, two buttons, two pastes, and only reachable from the full
 * record.
 *
 * What one click can be is decided by the machine, because the ceiling is
 * different on each and neither can be argued with:
 *
 *  - A phone has WhatsApp in its share sheet, so `navigator.share` with a
 *    file and some text is the whole job: tap, pick the group, send. The
 *    text rides along as the caption.
 *  - A laptop cannot do that. WhatsApp Desktop is not a share target, and a
 *    clipboard holds one thing — so the photograph goes on it and the
 *    caption is offered on the toast for the people who want it. One click,
 *    one paste, and a second click only if the words are wanted.
 *
 * No web page can post into a WhatsApp group by itself; there is no API for
 * it, groups are not addressable even from the Business API. One click and
 * one paste is the floor, and this is at it.
 */
export function WhatsAppPost({ watch, tradePrice, imageId, size = 'md' }: {
  watch: PostableWatch
  /** Formatted AED — "AED 48,500" — or null where none is set. */
  tradePrice: string | null
  /** The trade shot, or the watch shot. Null where there is neither. */
  imageId: string | null
  size?: 'sm' | 'md'
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const message = whatsappPost(watch, { tradePrice })

  function flash() {
    setDone(true)
    setTimeout(() => setDone(false), 2500)
  }

  async function send() {
    setBusy(true)
    try {
      const file = imageId ? await fetchImage(imageId, watch) : null

      // The phone: one tap, picture and caption together. Gated on a coarse
      // pointer rather than on `canShare`, because a Mac answers yes to that
      // and then offers a sheet with no WhatsApp in it.
      if (file && isTouchDevice() && typeof navigator.share === 'function'
        && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: message })
        flash()
        return
      }

      if (!file) {
        await navigator.clipboard.writeText(message)
        toast.success('Caption copied', 'No photograph on this one yet.')
        flash()
        return
      }

      await navigator.clipboard.write([new ClipboardItem({ 'image/png': await toPng(file) })])
      toast.toast({
        tone: 'success',
        title: 'Photo copied — paste into the group',
        description: message,
        // The caption is one click away rather than a step everybody has to
        // walk through. Most posts are the picture; the words are a choice.
        action: {
          label: 'Copy caption',
          onClick: () => { void navigator.clipboard.writeText(message) },
        },
        duration: 10_000,
      })
      flash()
    } catch (error) {
      // Dismissing the share sheet rejects with AbortError. Somebody changing
      // their mind is not a failure to report back to them.
      if ((error as Error)?.name === 'AbortError') return
      try {
        await navigator.clipboard.writeText(message)
        toast.error('Could not copy the photo', 'The caption is on the clipboard — attach the photo by hand.')
      } catch {
        toast.error('Could not copy', 'Open the photograph from the gallery and copy it by hand.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size={size}
      onClick={send}
      loading={busy}
      icon={done ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
    >
      {done ? 'Copied' : 'Send to group'}
    </Button>
  )
}

/**
 * A phone or a tablet, rather than a laptop with a share sheet it cannot use.
 *
 * Pointer type rather than user agent: a coarse pointer is a finger, which is
 * the same population as "this operating system treats WhatsApp as somewhere
 * you can share to". An iPad with a keyboard still reports coarse, which is
 * the right answer for it, and no Mac reports coarse at all.
 */
function isTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse)').matches
}

/** The photograph, as a file the share sheet will accept. */
async function fetchImage(imageId: string, watch: PostableWatch): Promise<File | null> {
  const response = await fetch(`/api/images/${imageId}`)
  if (!response.ok) return null
  const blob = await response.blob()
  return new File([blob], postFilename(watch, blob.type), { type: blob.type })
}

/** Re-encode to PNG, which is the only thing a clipboard will take. */
async function toPng(file: File): Promise<Blob> {
  if (file.type === 'image/png') return file
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas context')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))), 'image/png')
  })
}
