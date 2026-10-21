'use client'
import { useState } from 'react'
import { Check, Send } from 'lucide-react'
import { Button, Modal, useToast } from '@/components/ui'
import { groupPostsAction } from '@/app/actions/watches'
import { describeSkips, type GroupPost, type GroupPostBatch as Batch } from '@/lib/group-post'

/**
 * Send a selection of watches to a group, one message each.
 *
 * A browser will only open the share sheet in direct response to a tap, so a
 * loop that fires six shares is not available at any price — the second one
 * is refused for want of a user gesture. What is available is a queue with a
 * button on it: tap, send that watch, come back, tap again. One tap per
 * watch, each arriving in the group as its own message that can be replied
 * to and quoted on its own, which is how a trade group reads.
 *
 * The queue is the honest shape of the constraint rather than a workaround
 * for it, and it earns its place by removing everything else: no opening six
 * records, no finding six photographs, no typing six prices.
 */
export function GroupPostBatch({ watchIds, onDone }: {
  watchIds: string[]
  onDone: () => void
}) {
  const toast = useToast()
  const [batch, setBatch] = useState<Batch | null>(null)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string[]>([])

  async function open() {
    setBusy(true)
    const result = await groupPostsAction(watchIds)
    setBusy(false)
    if (!result.ok) {
      toast.error('Could not prepare the batch', result.message)
      return
    }
    if (result.batch.posts.length === 0) {
      toast.error('Nothing to send', describeSkips(result.batch) || 'None of those can be posted.')
      return
    }
    setIndex(0)
    setSent([])
    setBatch(result.batch)
  }

  async function sendCurrent(post: GroupPost) {
    setBusy(true)
    try {
      const file = await fetchImage(post)
      if (file && isTouchDevice() && typeof navigator.share === 'function'
        && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: post.caption })
      } else if (file) {
        // The laptop: the photograph to the clipboard and the caption behind
        // one more click, the same bargain the single-watch button strikes.
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': await toPng(file) })])
        toast.toast({
          tone: 'success',
          title: `Photo copied — ${post.label}`,
          description: post.caption,
          action: {
            label: 'Copy caption',
            onClick: () => { void navigator.clipboard.writeText(post.caption) },
          },
          duration: 8000,
        })
      } else {
        await navigator.clipboard.writeText(post.caption)
      }
      setSent((previous) => [...previous, post.watchId])
      advance()
    } catch (error) {
      // Backing out of the share sheet is a decision, not a failure, and it
      // must not advance the queue — the watch has not gone anywhere.
      if ((error as Error)?.name === 'AbortError') return
      toast.error('Could not send that one', 'Skip it and carry on, or close and try again.')
    } finally {
      setBusy(false)
    }
  }

  function advance() {
    setIndex((current) => {
      const next = current + 1
      if (batch && next >= batch.posts.length) {
        toast.success('Batch finished', `${batch.posts.length} ${batch.posts.length === 1 ? 'watch' : 'watches'} sent.`)
        setBatch(null)
        onDone()
        return 0
      }
      return next
    })
  }

  const post = batch?.posts[index] ?? null

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={open}
        loading={busy && !batch}
        icon={<Send className="h-4 w-4" />}
      >
        Send to group
      </Button>

      <Modal
        open={Boolean(batch && post)}
        onClose={() => { setBatch(null); onDone() }}
        title="Send to a WhatsApp group"
        description={batch ? `${index + 1} of ${batch.posts.length}${describeSkips(batch) ? ` · ${describeSkips(batch)}` : ''}` : undefined}
        size="md"
      >
        {batch && post && (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-2" aria-hidden>
              {batch.posts.map((item, position) => (
                <span
                  key={item.watchId}
                  className={
                    'h-1.5 flex-1 rounded-full '
                    + (sent.includes(item.watchId)
                      ? 'bg-state-good'
                      : position === index ? 'bg-content-primary' : 'bg-surface-subtle')
                  }
                />
              ))}
            </div>

            <div>
              <p className="text-caption font-semibold uppercase tracking-wider text-content-secondary">
                Stock No. {post.stockNo}
              </p>
              <p className="text-h2 font-extrabold text-content-primary">{post.label}</p>
            </div>

            <pre className="whitespace-pre-wrap rounded-md border border-line-subtle bg-surface-subtle px-4 py-3 text-small text-content-primary">
              {post.caption}
            </pre>

            <div className="flex flex-wrap items-center gap-2.5">
              <Button type="button" onClick={() => sendCurrent(post)} loading={busy} icon={<Send className="h-4 w-4" />}>
                {index + 1 === batch.posts.length ? 'Send last' : 'Send this one'}
              </Button>
              <Button type="button" variant="ghost" onClick={advance} disabled={busy}>
                Skip
              </Button>
              {sent.length > 0 && (
                <span className="ml-auto inline-flex items-center gap-1.5 text-small text-content-secondary">
                  <Check className="h-4 w-4 text-state-good" aria-hidden />
                  {sent.length} sent
                </span>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

function isTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse)').matches
}

async function fetchImage(post: GroupPost): Promise<File | null> {
  const response = await fetch(`/api/images/${post.imageId}`)
  if (!response.ok) return null
  const blob = await response.blob()
  const stem = post.label.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  const extension = blob.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
  return new File([blob], `${stem || 'watch'}.${extension}`, { type: blob.type })
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
