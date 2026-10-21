'use client'
import { useState } from 'react'
import { Check, Copy, Image as ImageIcon, Send } from 'lucide-react'
import { Button, Modal, useToast } from '@/components/ui'
import { postFilename, whatsappPost, type PostableWatch } from '@/lib/whatsapp-post'

/**
 * Put a watch into a dealer group, picture and all.
 *
 * One constraint shapes the whole of this: a clipboard holds one thing at a
 * time, and WhatsApp wants two. `ClipboardItem` will carry an image and some
 * text together, but the receiving application picks a single representation
 * and WhatsApp picks the image — so a lone "copy" button silently drops the
 * reference and the price, which are the entire point of the message.
 *
 * There are two different answers to that, for two different machines.
 *
 * On a phone the share sheet sidesteps it completely: `navigator.share` with
 * a file and some text hands WhatsApp an image carrying that text as its
 * caption, in one tap. That is the whole interaction, and it is where these
 * groups mostly get posted to.
 *
 * A laptop has no share sheet, and WhatsApp Desktop takes a pasted image by
 * opening a preview with a caption box under it — photograph first, caption
 * second, two pastes. So rather than pretend otherwise, the desktop path
 * opens a small panel that hands over one, then the other, in that order,
 * and says so. Two clicks and two pastes is not one tap, but it is the real
 * shape of the application being pasted into.
 */
export function WhatsAppPost({ watch, tradePrice, imageId }: {
  watch: PostableWatch
  /** Formatted on the server — "AED 48,500" — or null if none is set. */
  tradePrice: string | null
  /** The photograph to send. Null where the watch has none yet. */
  imageId: string | null
}) {
  const toast = useToast()
  const [sharing, setSharing] = useState(false)
  const [panel, setPanel] = useState(false)

  const message = whatsappPost(watch, { tradePrice })

  async function start() {
    // The phone path. `canShare` is asked with the actual file, because a
    // browser can support sharing text and still refuse files.
    if (imageId && typeof navigator.share === 'function') {
      setSharing(true)
      try {
        const file = await fetchImage(imageId, watch)
        if (file && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], text: message })
          return
        }
      } catch (error) {
        // Dismissing the sheet rejects with AbortError. That is somebody
        // changing their mind, not a failure.
        if ((error as Error)?.name === 'AbortError') return
      } finally {
        setSharing(false)
      }
    }
    setPanel(true)
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={start}
        loading={sharing}
        icon={<Send className="h-4 w-4" />}
      >
        Send to group
      </Button>

      <Modal
        open={panel}
        onClose={() => setPanel(false)}
        title="Send to a WhatsApp group"
        description="WhatsApp takes the photo first and the caption second, so this hands them over in that order."
        size="md"
      >
        <div className="flex flex-col gap-5">
          <Step
            number={1}
            title="Copy the photo, then paste it into the group"
            detail={imageId
              ? 'WhatsApp opens a preview with a caption box underneath.'
              : 'This watch has no photograph yet — skip to the caption.'}
          >
            <CopyPhoto imageId={imageId} watch={watch} onFail={(m) => toast.error('Could not copy the photo', m)} />
          </Step>

          <Step
            number={2}
            title="Copy the caption, then paste it into that box"
            detail="Press send once both are in."
          >
            <CopyText value={message} onFail={() => toast.error('Could not copy', 'Select the text and copy it by hand.')} />
          </Step>

          {/* Shown rather than hidden behind the button: somebody should be
              able to read what they are about to post before they post it,
              and retype a word of it if they want to. */}
          <pre className="whitespace-pre-wrap rounded-md border border-line-subtle bg-surface-subtle px-4 py-3 text-small text-content-primary">
            {message}
          </pre>
        </div>
      </Modal>
    </>
  )
}

function Step({ number, title, detail, children }: {
  number: number
  title: string
  detail: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <span
        aria-hidden
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-caption font-semibold text-content-secondary"
      >
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <div>
          <p className="text-body font-semibold text-content-primary">{title}</p>
          <p className="text-small text-content-secondary">{detail}</p>
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * The photograph onto the clipboard.
 *
 * Re-encoded to PNG first. Browsers will only put an image on the clipboard
 * as PNG, and a watch photograph is a JPEG, so handing the blob over
 * unchanged fails on every one of them. Falls back to a download where the
 * clipboard refuses entirely, which is better than a dead button.
 */
function CopyPhoto({ imageId, watch, onFail }: {
  imageId: string | null
  watch: PostableWatch
  onFail: (message: string) => void
}) {
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!imageId) return null

  async function run() {
    setBusy(true)
    try {
      const file = await fetchImage(imageId!, watch)
      if (!file) throw new Error('no image')
      const png = await toPng(file)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      setDone(true)
      setTimeout(() => setDone(false), 3000)
    } catch {
      try {
        const file = await fetchImage(imageId!, watch)
        if (file) {
          download(file)
          onFail('Downloaded it instead — drag it into WhatsApp.')
          return
        }
      } catch {
        // Falls through to the message below.
      }
      onFail('Open the photograph from the gallery and copy it by hand.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button type="button" variant="secondary" size="sm" onClick={run} loading={busy}
      icon={done ? <Check className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}>
      {done ? 'Photo copied' : 'Copy photo'}
    </Button>
  )
}

function CopyText({ value, onFail }: { value: string; onFail: () => void }) {
  const [done, setDone] = useState(false)

  async function run() {
    try {
      await navigator.clipboard.writeText(value)
      setDone(true)
      setTimeout(() => setDone(false), 3000)
    } catch {
      onFail()
    }
  }

  return (
    <Button type="button" variant="secondary" size="sm" onClick={run}
      icon={done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}>
      {done ? 'Caption copied' : 'Copy caption'}
    </Button>
  )
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

function download(file: File): void {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  // Revoked on the next tick rather than immediately: Safari has not started
  // reading the blob by the time click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
