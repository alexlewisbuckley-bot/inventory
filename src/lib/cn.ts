import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * Class merger, taught about our custom scales.
 *
 * `tailwind-merge` resolves conflicts by classifying each utility into a
 * group. Out of the box it does not know our type ramp, so `text-micro` looks
 * like it *might* be a colour — and when it appears alongside a real colour
 * such as `text-content-secondary`, the merger treats them as conflicting and
 * silently drops the size.
 *
 * That failure is invisible: no error, no warning, just type rendering at the
 * inherited size. It was live across the application until table headers
 * turned out to be rendering at the wrong size. Declaring the groups below
 * makes the classification explicit, so a size and a colour can coexist.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{
        text: ['micro', 'caption', 'small', 'body', 'body-lg', 'h3', 'h2', 'h1', 'display'],
      }],
    },
  },
})

/** Merge conditional class names, with later Tailwind utilities winning conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
