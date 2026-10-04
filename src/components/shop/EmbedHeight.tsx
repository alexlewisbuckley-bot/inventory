'use client'
import { useEffect } from 'react'

/**
 * Tell the page we are sitting in how tall we have become.
 *
 * An iframe has no opinion about its own height, so without this the stock
 * list gets an arbitrary box with a second scrollbar inside the reseller's
 * page — the thing that makes an embed look like an embed. A `ResizeObserver`
 * on the body and a message to the parent on every change keeps the frame the
 * exact height of its contents, so opening a watch or filtering the list grows
 * and shrinks their page as if the markup were theirs.
 *
 * The message carries a name of its own because a page may be running other
 * people's scripts, and a bare number arriving from an unknown frame is the
 * kind of thing that moves somebody else's furniture.
 */
export function EmbedHeight() {
  useEffect(() => {
    if (window.parent === window) return

    let last = 0
    const send = () => {
      const height = Math.ceil(document.documentElement.scrollHeight)
      if (height === last) return
      last = height
      // '*' deliberately: the embedding page is the reseller's and we do not
      // know its address. The payload is a height — there is nothing in it
      // worth keeping from whoever is listening.
      window.parent.postMessage({ type: 'one-street-shop:height', height }, '*')
    }

    send()
    const observer = new ResizeObserver(send)
    observer.observe(document.documentElement)
    // Images arriving late change the height after the observer has settled.
    window.addEventListener('load', send)
    const timer = setInterval(send, 1000)

    return () => {
      observer.disconnect()
      window.removeEventListener('load', send)
      clearInterval(timer)
    }
  }, [])

  return null
}
