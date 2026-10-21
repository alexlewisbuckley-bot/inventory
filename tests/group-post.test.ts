import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SKIP_LABELS, describeSkips } from '@/lib/group-post'

/**
 * The batch's job is to be faster than doing it by hand, and to never post
 * something embarrassing on the way. Both halves are asserted here.
 */

describe('what the batch refuses to post', () => {
  const service = readFileSync('src/server/services/group-post-service.ts', 'utf8')

  it('skips a sold watch', () => {
    expect(service).toMatch(/row\.status === 'SOLD'/)
    expect(SKIP_LABELS.sold).toBe('already sold')
  })

  it('skips a watch with no trade price rather than posting it priceless', () => {
    expect(service).toMatch(/if \(!row\.tradePriceGbp\)/)
    expect(SKIP_LABELS['no-price']).toBe('no trade price')
  })

  it('skips a watch with no photograph', () => {
    expect(service).toMatch(/if \(!imageId\)/)
    expect(SKIP_LABELS['no-photo']).toBe('no photograph')
  })

  it('reports every omission rather than quietly shortening the batch', () => {
    // A batch of ten going out as seven must be something the sender knows.
    expect(service).toMatch(/skipped\.push\(\{ stockNo: row\.stockNo, label, reason: 'sold' \}\)/)
    expect(service).toMatch(/reason: 'no-price'/)
    expect(service).toMatch(/reason: 'no-photo'/)
  })

  it('uses the same photograph rule as everywhere else', () => {
    expect(service).toMatch(/pickPostImage\(/)
  })

  it('prices in dirhams, not the reader\'s display currency', () => {
    expect(service).toMatch(/formatCurrency\(row\.tradePriceGbp, BASE_CURRENCY\)/)
  })

  it('keeps the order the watches were selected in', () => {
    expect(service).toMatch(/order\.get\(a\.id\)/)
  })

  it('excludes deleted watches', () => {
    expect(service).toMatch(/isNull\(watches\.deletedAt\)/)
  })
})

describe('the capability is asserted on the server', () => {
  const actions = readFileSync('src/app/actions/watches.ts', 'utf8')

  it('requires watch:broadcast before handing back trade prices', () => {
    // Hiding the button is not access control: this hands back the trade
    // price for a whole selection in one call.
    expect(actions).toMatch(/groupPostsAction/)
    expect(actions).toMatch(/requireCapability\('watch:broadcast'\)/)
  })
})

describe('the queue is honest about the browser constraint', () => {
  const batch = readFileSync('src/components/inventory/GroupPostBatch.tsx', 'utf8')

  it('sends one watch per tap rather than looping shares', () => {
    // A second navigator.share without a fresh user gesture is refused, so
    // a loop would silently send one of six.
    expect(batch).not.toMatch(/for \(const post of/)
    expect(batch).toMatch(/sendCurrent\(post\)/)
  })

  it('does not advance when somebody backs out of the share sheet', () => {
    // The watch has not gone anywhere; moving on would skip it silently.
    expect(batch).toMatch(/AbortError'\) return/)
  })

  it('shows the caption before it goes', () => {
    expect(batch).toMatch(/\{post\.caption\}/)
  })

  it('tells the sender what was left out, and why', () => {
    expect(batch).toMatch(/describeSkips\(/)
  })
})

describe('the selection bar offers it to the owner only', () => {
  const bar = readFileSync('src/components/inventory/BulkActionBar.tsx', 'utf8')

  it('renders behind the capability', () => {
    expect(bar).toMatch(/capabilities\['watch:broadcast'\] && \(/)
    expect(bar).toMatch(/<GroupPostBatch watchIds=\{watchIds\}/)
  })

  it('is withheld in select-everything-matching mode', () => {
    // That selection is a filter, not a list of ids, and a batch has to be
    // walked one tap at a time — nobody wants to start that on 312 rows.
    expect(bar).toMatch(/!allMatching && capabilities\['watch:broadcast'\]/)
  })
})

describe('the shared shapes stay out of the browser bundle', () => {
  const client = readFileSync('src/components/inventory/GroupPostBatch.tsx', 'utf8')

  it('the queue imports nothing from the service', () => {
    // It did, for SKIP_LABELS, and that pulled the database client and
    // node:async_hooks into the client bundle — the build failed outright.
    expect(client).not.toMatch(/@\/server\//)
    expect(client).toMatch(/from '@\/lib\/group-post'/)
  })

  it('counts the omissions by reason', () => {
    expect(describeSkips({ posts: [], skipped: [] })).toBe('')
    expect(describeSkips({
      posts: [],
      skipped: [
        { stockNo: 1, label: 'a', reason: 'sold' },
        { stockNo: 2, label: 'b', reason: 'sold' },
        { stockNo: 3, label: 'c', reason: 'no-price' },
      ],
    })).toBe('3 left out: 2 already sold, 1 no trade price')
  })
})

describe('a phone can pick rows at all', () => {
  const list = readFileSync('src/components/inventory/InventoryList.tsx', 'utf8')

  it('offers selection on the card list, not only the table', () => {
    // Below sm the table is replaced by cards, which had no checkbox — so
    // the one bulk job done standing up could only be started from a desk.
    expect(list).toMatch(/selectable=\{selectable\}\n\s+selected=\{selection\.isSelected\(watch\.id\)\}/)
  })

  it('counts broadcasting as a reason to select', () => {
    expect(list).toMatch(/\|\| capabilities\['watch:broadcast'\]/)
  })
})
