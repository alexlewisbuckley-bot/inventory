import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Looking at a photograph properly.
 *
 * Every picture in this system was shown at a hundred-odd pixels across,
 * which is enough to recognise a watch and nowhere near enough to do the
 * thing the photograph is for. A trade shot exists so somebody can read a
 * date off a card or see whether a bracelet is stretched; a warranty card is
 * a photograph of small print. The only way to look properly was to open the
 * image route in another tab, which works and which nobody thinks to do — so
 * in practice the pictures were decorative.
 *
 * One viewer, used everywhere, rather than six screens each growing their own
 * and disagreeing about what Escape does.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const code = (path: string) => read(path)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')

describe('the viewer', () => {
  const source = read('src/components/ui/Lightbox.tsx')

  it('shows the whole picture rather than a well-composed part of it', () => {
    // A viewer that crops is a viewer that hides the edge of the card you
    // opened it to read.
    expect(source).toMatch(/object-contain/)
    expect(code('src/components/ui/Lightbox.tsx')).not.toMatch(/object-cover/)
  })

  it('closes the ways people expect it to', () => {
    expect(source).toMatch(/event\.key === 'Escape'/)
    // The backdrop, with the picture itself stopping the click so that
    // dragging a selection across it is not a dismissal.
    expect(source).toMatch(/onClick=\{onClose\}/)
    expect(source).toMatch(/event\.stopPropagation\(\)/)
  })

  it('pages with the arrow keys, and wraps', () => {
    expect(source).toMatch(/ArrowRight/)
    expect(source).toMatch(/ArrowLeft/)
    expect(source).toMatch(/\(index \+ by \+ count\) % count/)
  })

  it('stops the page scrolling underneath itself', () => {
    // Otherwise a flick on a phone moves the list behind the picture.
    expect(source).toMatch(/document\.body\.style\.overflow = 'hidden'/)
    // And puts back whatever was there, rather than assuming it was ''.
    expect(source).toMatch(/const \{ overflow \} = document\.body\.style/)
    expect(source).toMatch(/document\.body\.style\.overflow = overflow/)
  })

  it('can be opened from the keyboard, not only the mouse', () => {
    // A thumbnail that opens something is a button, whatever element it is.
    expect(source).toMatch(/role: 'button'/)
    expect(source).toMatch(/tabIndex: 0/)
    expect(source).toMatch(/event\.key !== 'Enter' && event\.key !== ' '/)
  })

  it('is rendered outside the layout it was opened from', () => {
    // Opened from inside a drawer or a table, anything else would be clipped
    // by a scroller or sat under its own page's chrome.
    expect(source).toMatch(/createPortal/)
  })
})

describe('where you can enlarge a photograph', () => {
  it('is everywhere one is shown', () => {
    const screens: Array<[string, RegExp]> = [
      // A watch's own photographs, which page as one set across the kinds:
      // checking a serial against a card wants both, and they sit in two
      // different sections.
      ['src/components/inventory/ImageGallery.tsx', /<Lightbox/],
      // The import, where somebody is deciding which watch a photograph
      // belongs to and whether it is the card or the watch.
      ['src/components/inventory/PhotoIntake.tsx', /<Zoomable/],
      // The stock check, where they are holding the watch.
      ['src/components/stock/StockCheckRunner.tsx', /<Zoomable/],
      ['src/components/catalogue/CatalogueGrid.tsx', /<Zoomable/],
      // The stock grid's card is a link to the watch, so enlarging is its own
      // control rather than a theft of the card's click.
      ['src/components/inventory/InventoryGallery.tsx', /<ZoomButton/],
    ]
    for (const [path, wanted] of screens) expect(read(path), path).toMatch(wanted)
  })

  it('never takes a click that already meant something', () => {
    const button = read('src/components/ui/Lightbox.tsx')
    const control = button.slice(button.indexOf('export function ZoomButton'))
    expect(control).toMatch(/event\.preventDefault\(\); event\.stopPropagation\(\)/)
  })
})

describe('a watch you can recognise without reading it', () => {
  it('has its photograph in the table, not only in the gallery', () => {
    // The table knew every fact about a piece and showed none of what it
    // looks like, so picking one out of four hundred rows meant reading
    // references. The gallery does show them and gives up every figure to do
    // it, which is a different screen rather than the same one done better.
    const list = read('src/components/inventory/InventoryList.tsx')
    expect(list).toMatch(/\{ key: 'photo', label: 'Photo' \}/)
    expect(list).toMatch(/photo: 64/)
    expect(list).toMatch(/<Thumb watch=\{watch\} dimmed=\{sold\} \/>/)
  })

  it('counts the column width when deciding the table has to scroll', () => {
    // The widths are summed to a minimum, and a column left out of that sum
    // is a column the others get squeezed to make room for.
    const list = read('src/components/inventory/InventoryList.tsx')
    const sum = list.slice(list.indexOf('const tableMinWidth'))
    expect(sum.slice(0, 400)).toMatch(/'photo', 'year'/)
  })

  it('falls back to the trade shot, and says so when there is neither', () => {
    // On this screen the question is "which watch is this", and the picture
    // taken on the desk answers it as well as the catalogue one does.
    const list = read('src/components/inventory/InventoryList.tsx')
    expect(list).toMatch(/watch\.primaryImageId \?\? watch\.tradeImageId/)
    expect(list).toMatch(/title="No photograph"/)
  })
})
