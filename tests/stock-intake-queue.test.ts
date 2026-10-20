import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'src/components/inventory/StockIntake.tsx'), 'utf8')

/**
 * A delivery arrives as a spreadsheet of new stock and a folder of
 * photographs of it. The page asked "which first?" and kept only the answer:
 * pick the spreadsheet and the photographs were discarded, so booking in one
 * delivery meant finding the same folder twice.
 */
describe('the rest of a mixed drop', () => {
  it('is kept rather than thrown away when one kind is chosen', () => {
    expect(source).toMatch(/const \[queue, setQueue\] = useState<Batch\[\]>\(\[\]\)/)
    expect(source).toMatch(/setQueue\(ambiguous \? \[\] : choices\.filter/)
  })

  it('does not queue the other reading of a single ambiguous image', () => {
    // One image offered as "photograph or invoice?" is one question about
    // one file, not two jobs. Queuing the rejected reading would offer to
    // import the same picture again as an invoice.
    expect(source).toMatch(/const ambiguous = choices !== null && choices\.length === 2/)
    expect(source).toMatch(/choices\[0\]!\.files === choices\[1\]!\.files/)
  })

  it('refreshes before handing on, so new stock is there to match against', () => {
    // The usual order is a spreadsheet and then its photographs. The watches
    // the import just created are not in the candidate list this page
    // rendered with, and matching against the older list reports every one
    // of them as unmatched.
    expect(source).toMatch(/const continueWith = \(next: Batch\) => \{\s*\n\s*router\.refresh\(\)/)
  })

  it('rebuilds the matches when the longer candidate list arrives', () => {
    // PhotoIntake seeds itself once per mount, so a refresh that lands after
    // it mounted would otherwise change nothing.
    expect(source).toMatch(/key=\{candidates\.length\}/)
  })

  it('clears the queue on a fresh drop and on starting over', () => {
    expect(source).toMatch(/setRejected\(null\)\s*\n\s*setQueue\(\[\]\)/)
    expect(source).toMatch(/const startOver = \(\) => \{[^}]*setQueue\(\[\]\)/)
  })

  it('stops promising a "first" that never had a second', () => {
    expect(source).toMatch(/Which first\? The rest stay in hand\./)
  })
})
