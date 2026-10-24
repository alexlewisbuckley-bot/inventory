'use server'
import { requireCapability } from '@/server/auth/session'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { findWatches } from '@/server/repositories/watch-repository'
import { shopVocabulary } from '@/server/services/shopify-service'
import { suggestFromClaude } from '@/server/services/gap-ai'
import { suggestFromBook, unresolved, storable, type GapRow, type Suggestion } from '@/lib/gap-suggestions'
import { HELD_STATUSES } from '@/lib/enums'
import { logger } from '@/lib/logger'

/**
 * Looking for answers to the blanks on the content page.
 *
 * Read-only, deliberately and completely. It reads the book, reads the shop's
 * vocabulary, and returns proposals; accepting one goes back through
 * `amendWatchAction`, the same path as typing into the cell, so a suggestion
 * is validated, version-checked and written to the audit log exactly as a
 * person's own edit is. There is no route by which this writes to a watch,
 * which is the property worth having rather than the convenient one.
 */

export interface GapScanResult {
  ok: boolean
  suggestions: Suggestion[]
  /** How many blanks there were, so "none found" reads differently from "none left". */
  gaps: number
  /** Whether Claude was asked at all — unconfigured key, or nothing left to ask about. */
  askedClaude: number
  /** A reason the AI half produced nothing, shown rather than swallowed. */
  notice?: string
  message?: string
}

export async function scanGapsAction(): Promise<GapScanResult> {
  // The same capability the page itself asks for. Reading the book and the
  // shop's own lists tells somebody nothing they could not already see on the
  // grid below.
  const actor = await requireCapability('watch:update')
  // An API call per press, so the mutation budget rather than a read one.
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  try {
    const [result, vocabulary] = await Promise.all([
      findWatches({
        status: [...HELD_STATUSES],
        sort: 'stockNo',
        dir: 'asc',
        page: 1,
        perPage: 200,
        includeDeleted: false,
      }),
      shopVocabulary(),
    ])

    const rows: GapRow[] = result.items.map((watch) => ({
      id: watch.id,
      stockNo: watch.stockNo,
      brandName: watch.brandName,
      model: watch.model,
      nickname: watch.nickname,
      caseSizeMm: watch.caseSizeMm,
    }))

    // The book first, always. It is free, it is instant, and its evidence is
    // records the business wrote itself.
    const fromBook = suggestFromBook(rows)
    const left = unresolved(rows, fromBook)
    const gaps = fromBook.length + left.reduce((n, entry) => n + entry.fields.length, 0)

    const ai = await suggestFromClaude(left, vocabulary.choices)

    // A size the shop has no entry for would be accepted, written, and change
    // nothing on the card, because the push drops an unmatched one in
    // silence. Checked for both tiers: the book can hold a size the shop
    // never had an entry created for just as easily as Claude can name one.
    const offered = [...fromBook, ...ai.suggestions].filter((suggestion) =>
      storable(suggestion.value, suggestion.field, vocabulary.choices),
    )

    logger.info('gap scan', {
      held: rows.length,
      gaps,
      fromBook: fromBook.length,
      fromClaude: ai.suggestions.length,
      offered: offered.length,
    })

    return {
      ok: true,
      suggestions: offered,
      gaps,
      askedClaude: ai.asked,
      notice: ai.error ?? undefined,
    }
  } catch (error) {
    logger.error('gap scan failed', { error: (error as Error).message })
    return {
      ok: false,
      suggestions: [],
      gaps: 0,
      askedClaude: 0,
      message: 'The scan could not be run. Nothing has been changed.',
    }
  }
}
