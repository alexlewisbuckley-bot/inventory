import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'src/components/inventory/StockIntake.tsx'), 'utf8')

/**
 * Dropping a file and having nothing whatever happen is indistinguishable
 * from the page being broken, and it is what this page did for anything that
 * was not a PDF, a spreadsheet or an image: the state was cleared and the
 * function returned. The file was named, classified, discarded and never
 * mentioned.
 */
describe('a drop this page cannot use', () => {
  it('says so instead of returning in silence', () => {
    expect(source).toMatch(/setRejected\(/)
    // The old code path: clear everything and give up without a word.
    expect(source).not.toMatch(/setChoices\(null\)\s*\n\s*setBatch\(null\)\s*\n\s*return/)
  })

  it('names the file rather than saying something went wrong', () => {
    // "An error occurred" sends somebody to ask for help; "notes.txt is not
    // a PDF" sends them to find the right file.
    expect(source).toMatch(/not a PDF, a spreadsheet or an image/)
  })

  it('distinguishes a file it cannot read from one you may not import', () => {
    // Two different problems. One is the wrong file, the other is the wrong
    // account, and telling somebody to find a different file when the
    // permission is what stopped them wastes their afternoon.
    expect(source).toMatch(/cannot import/)
  })

  it('points at the manual form, which is what people are often after', () => {
    // "Bring stock in" takes files only. Somebody who meant to type a watch
    // in has no way to tell that from this page.
    expect(source).toMatch(/\/inventory\/new/)
  })

  it('clears the complaint when the next drop lands', () => {
    expect(source).toMatch(/if \(!files\.length\) return\s*\n\s*setRejected\(null\)/)
  })
})
