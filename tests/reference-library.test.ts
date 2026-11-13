import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { referenceKey } from '@/server/services/image-service'

/**
 * One reference, one shelf.
 *
 * The library is only useful if `126711 CHNR`, `126711-chnr` and
 * `126711CHNR` are the same model. Three spellings means three shelves, and
 * three shelves means the photograph taken last March is not found when the
 * next one of these comes in — which is the whole thing this exists to stop.
 */
describe('shelving a photograph by reference', () => {
  it('reads separators and case as noise', () => {
    const want = '126711CHNR'
    for (const spelling of ['126711CHNR', '126711 CHNR', '126711-chnr', ' 126711_CHNR ', '126711/chnr']) {
      expect(referenceKey(spelling)).toBe(want)
    }
  })

  it('keeps references that differ by a character apart', () => {
    expect(referenceKey('116610LV')).not.toBe(referenceKey('116610LN'))
    expect(referenceKey('5167R')).not.toBe(referenceKey('5167G'))
  })

  /** The field is free text, and some of it reads `Explorer II 343591`. */
  it('shelves a reference written as a phrase under the whole phrase', () => {
    expect(referenceKey('Explorer II 343591')).toBe('EXPLORERII343591')
    expect(referenceKey('explorer ii 343591')).toBe('EXPLORERII343591')
  })

  /** Nothing to shelve under is not a shelf called "". */
  it('gives nothing back for a reference that is only punctuation', () => {
    expect(referenceKey('')).toBe('')
    expect(referenceKey('  -- ')).toBe('')
  })
})

const read = (path: string) => readFileSync(path, 'utf8')
const gallery = read('src/components/inventory/ImageGallery.tsx')
const service = read('src/server/services/image-service.ts')
const route = read('src/app/api/reference-images/[id]/route.ts')

/**
 * Taking a photograph back off the shelf.
 *
 * Alex: "You should be able to remove an image that has been associated with
 * the wrong reference number in the past."
 *
 * You could — but only from the library dialog, and the only door to that
 * dialog on a watch with no photographs is the "+N more" button, which does
 * not exist until there are five on the shelf. So a reference with two wrong
 * pictures banked against it offered both, on every watch of that model, with
 * nothing to click.
 */
describe('tidying the shelf', () => {
  it('offers the way off it beside the pictures themselves', () => {
    /*
     * Both places the shelf is shown: the strip under an empty gallery, which
     * is where somebody actually notices, and the dialog.
     */
    expect(gallery.match(/<ShelfRemove/g)).toHaveLength(2)

    // The strip is the one that was missing it, so pin it there specifically.
    const strip = gallery.slice(
      gallery.indexOf('already — use one?'),
      gallery.indexOf('Choose or drag files'),
    )
    expect(strip).toContain('<ShelfRemove')
    expect(strip).toContain('onClick={() => setShelving(image)}')
  })

  it('can be reached without a mouse to hover with', () => {
    /*
     * Hover-only is the tidier of the two and also the one where somebody on
     * an iPad can never remove anything at all. Hidden from the small screens
     * up, not from zero.
     */
    const control = gallery.slice(gallery.indexOf('function ShelfRemove'))
    expect(control).toContain('sm:opacity-0')
    expect(control).toContain('sm:group-hover/shelf:opacity-100')
    expect(control).toContain('focus-visible:opacity-100')
    // A bare `opacity-0` would hide it on a phone with no way to reveal it.
    expect(control).not.toMatch(/className="[^"]*\sopacity-0\s/)
  })

  it('names which shelf it is taking the picture off', () => {
    // "Remove" on a thumbnail of a watch, on a page about a watch, is a
    // sentence somebody reads as deleting the watch's photograph.
    const control = gallery.slice(gallery.indexOf('function ShelfRemove'))
    expect(control).toContain('photograph off the shelf')
    expect(gallery).toContain('Watches already using it keep their own copy')
  })

  it('takes nothing away from a watch that already used it', () => {
    /*
     * The copy a watch took is its own row, exactly as an upload would be —
     * so tidying the shelf must never reach into a gallery. A delete that
     * touched watch_images here would silently strip pictures off listings
     * that have been fine for months.
     */
    const remove = service.slice(
      service.indexOf('export async function removeLibraryImage'),
      service.indexOf('export async function removeLibraryImage') + 900,
    )
    expect(remove).toContain('db.delete(referenceImages)')
    expect(remove).not.toContain('watchImages')
    // And it is written down, because a shared shelf changing is the kind of
    // thing somebody else notices a fortnight later.
    expect(remove).toContain('recordAudit')
  })

  it('asks for the same capability as putting one on a watch', () => {
    // The shelf is only ever read by people who could attach from it, so the
    // door off it is the same door on.
    const del = route.slice(route.indexOf('export async function DELETE'))
    expect(del).toContain("requireCapability('watch:update')")
  })

  it('drops it out of the strip without a page reload', () => {
    // Otherwise the picture somebody has just removed is still sitting there
    // offering itself, and the obvious read is that it did not work.
    expect(gallery).toContain('images: current.images.filter((image) => image.id !== shelving.id)')
  })
})
