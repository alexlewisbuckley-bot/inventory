'use client'
import { useState } from 'react'
import { Check, Loader2, Send } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { postFilename, whatsappPost, type PostableWatch } from '@/lib/whatsapp-post'

/**
 * Put a watch into a dealer group, picture and all.
 *
 * One constraint shapes the whole of this: a clipboard cannot carry a picture
 * and some words as a single paste. `ClipboardItem` will hold both, but the
 * application being pasted into picks one representation, and WhatsApp picks
 * the image — so "copy" alone would silently drop the reference and the
 * price, which are the entire point of the message.
 *
 * The share sheet does not have that problem. `navigator.share` with a file
 * and some text hands WhatsApp an image with the text as its caption, which
 * is exactly the message being asked for, in one tap, on the phone where
 * these groups actually live. So that is the path when the browser offers it.
 *
 * Desktop has no share sheet, so it degrades honestly rather than pretending:
 * the words go to the clipboard and the photograph is downloaded, and the
 * toast says so. Two actions instead of one, but nothing is lost silently.
 */
export function WhatsAppPost({ watch, tradePrice, imageId }: {
  watch: PostableWatch
  /** Formatted on the server — "AED 48,500" — or null if none is set. */
  tradePrice: string | null
  /** The photograph to send. Null where the watch has none yet. */
  imageId: string | null
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const message = whatsappPost(watch, { tradePrice })

  async function run() {
    setBusy(true)
    try {
      const file = imageId ? await fetchImage(imageId, watch) : null

      // The phone path. `canShare` is asked with the actual file because a
      // browser can support sharing text and still refuse files.
      if (file && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: message })
        setDone(true)
        return
      }

      await navigator.clipboard.writeText(message)

      if (!file) {
        toast.success('Message copied', 'This watch has no photograph yet — paste the text into WhatsApp.')
        setDone(true)
        return
      }

      // No share sheet: hand over the photograph as a download and say so, so
      // nobody pastes the text and wonders where the picture went.
      download(file)
      toast.success('Message copied, photo downloaded', 'Paste the text into WhatsApp and attach the photo.')
      setDone(true)
    } catch (error) {
      // Dismissing the share sheet rejects with AbortError. That is somebody
      // changing their mind, not a failure, and telling them off for it would
      // be the application arguing with them.
      if ((error as Error)?.name === 'AbortError') return
      toast.error('Could not prepare the message', 'Copy the details from the record by hand.')
    } finally {
      setBusy(false)
      // Long enough to read, short enough that the button is ready for the
      // next watch rather than stuck congratulating itself.
      setTimeout(() => setDone(false), 2500)
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={run}
      loading={busy}
      icon={done ? <Check className="h-4 w-4" /> : busy ? <Loader2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}
    >
      {done ? 'Ready' : 'Send to group'}
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
