import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * That the sync actually sends photographs, every time it pushes.
 *
 * This is the bug as it was reported: "new images / product photos were not
 * replaced on Shopify". The cause was one condition —
 *
 *     const files = origin && isNew ? watch.imageIds.map(…) : []
 *
 * — which sent the pictures on the push that created the product and on no
 * push afterwards. Everything else about the sync worked, which is why it
 * looked like a feature that half existed rather than a line to delete.
 *
 * None of that is catchable by a unit test of the mapping functions, because
 * the mapping was never the problem: the function that built the file list
 * was correct and simply was not called. It is not catchable by a type
 * either. So the call site is read as text, the way `sql-dialect.test.ts` and
 * `image-audience.test.ts` read theirs — because this is a mistake that is
 * invisible everywhere except on the shop, weeks later, when somebody notices
 * the picture is the old one.
 */
const source = readFileSync(
  join(process.cwd(), 'src/server/services/shopify-service.ts'), 'utf8',
)

describe('pushing a watch', () => {
  it('works out its photographs on every push, not only the first', () => {
    expect(source).toMatch(/const files = mediaFilesFor\(watch, origin\)/)
    // The condition that caused this. Nothing about the file list may depend
    // on whether the product is new.
    expect(source).not.toMatch(/isNew\s*\?[^\n]*(?:files|imageIds|images)/)
    expect(source).not.toMatch(/(?:files|imageIds|images)[^\n]*&&\s*isNew/)
  })

  it('distinguishes sending no photographs from sending an empty list', () => {
    // `files` on productSet is declarative: `files: []` is an instruction to
    // remove every picture from the page. "We have nothing to say about the
    // photographs" has to be the absence of the field, which is what null is
    // for — so this must be a null check and never a length one.
    expect(source).toMatch(/\.\.\.\(files \? \{ files \} : \{\}\)/)
  })

  it('writes down which media row the shop made for each photograph', () => {
    // The other half of the fix. The column existed and was never filled in,
    // so even once pictures were sent on every push, every push would have
    // re-uploaded all of them.
    expect(source).toMatch(/rememberMedia\(watch, /)
    expect(source).toMatch(/shopifyMediaId: mediaId/)
    // Which needs the ids back out of the mutation.
    expect(source).toMatch(/media\(first: 50\) \{ nodes \{ id status \} \}/)
  })

  it('does not record a media row the shop could not make', () => {
    // A recorded id is what stops the next push retrying the upload, so
    // remembering a failed row makes a missing picture permanent.
    expect(source).toMatch(/=== 'FAILED' \? null :/)
  })

  it('forgets one watch’s media without forgetting everybody’s', () => {
    // forgetLinks takes an optional list of watches. The photograph half of
    // it ignored that list and cleared the whole table, which after this
    // change means re-uploading every photograph in the book.
    expect(source).toMatch(/inArray\(watchImages\.watchId, scope\)/)
  })
})
