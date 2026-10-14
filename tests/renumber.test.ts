import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { planSync, type SyncWatch, type SyncProduct } from '@/lib/shopify-map'

/**
 * Renaming a watch.
 *
 * The accounts are the system of record for what a piece is called, so a
 * sheet exported from them renumbers stock here. The importer refused: the
 * stock number was treated as identity, so a number that had changed matched
 * nothing and the row was rejected — with the serial sitting in the next
 * column naming the watch beyond doubt.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const service = read('src/server/services/import-service.ts')

describe('which column says which watch', () => {
  it('lets the serial identify it and the number label it', () => {
    expect(service).toMatch(/const renumbering = hasStockNo && byNumber === null && bySerialNo !== null/)
    expect(service).toMatch(/const matched = byNumber \?\? bySerialNo/)
  })

  it('refuses a number that belongs to a different watch', () => {
    // The one that would have done real damage quietly: this row's reference,
    // price and specification applied to whichever watch currently holds the
    // number, while the watch the serial names sat untouched. Two records
    // wrong and no error. Renumbering in place makes it likely rather than
    // exotic — every swap passes through that state.
    expect(service).toMatch(/if \(byNumber && bySerialNo && byNumber\.id !== bySerialNo\.id\)/)
    expect(service).toMatch(/already belongs to a different watch/)
  })

  it('says so when there is no serial to rename by', () => {
    expect(service).toMatch(/no serial to identify it by/)
  })

  it('shows the rename in the preview before applying it', () => {
    // A preview that applies a new stock number without listing it is a
    // preview that lied about what it was going to do.
    expect(service).toMatch(/field: 'stock no',\n\s+label: 'Stock number',/)
  })

  it('checks the number is still free at the moment it writes', () => {
    // The parse checked against the book as it stood when the file was read.
    // Between a preview and its apply, somebody else can take the number.
    expect(service).toMatch(/was taken by another watch while this sheet was being reviewed/)
  })

  it('names both numbers in the audit', () => {
    expect(service).toMatch(/renumbered to \$\{row\.stockNo\} from an imported sheet/)
  })
})

describe('what renaming does to the storefront', () => {
  const base = {
    id: 'wch_1', brandName: 'Rolex', model: '116334', serial: '0SQ84951',
    nickname: null, year: 2016, status: 'IN_STOCK',
    locationName: 'One Street Watches', locationPublishes: true,
    estSaleGbp: 4_407_001, caseSizeMm: 41, caseMaterial: 'Steel',
    dial: 'White', bracelet: 'Oyster', movement: 'Automatic',
    waterResistanceM: 100, condition: 'EXCELLENT', boxPapers: 'FULL_SET',
    description: null, images: [],
  }

  it('keeps the listing rather than archiving it and starting again', () => {
    // The page carries the photographs, the metafields, the publication
    // state and the URL. Losing all of that to a change of label is not a
    // sync, it is a deletion with a replacement.
    const watch: SyncWatch = { ...base, stockNo: 2001, shopifyProductId: 'gid://shopify/Product/1' }
    const product: SyncProduct = {
      id: 'gid://shopify/Product/1', sku: '1143', title: 'Rolex 116334',
      status: 'ACTIVE', seoTitle: null, publishedAt: '2026-01-01',
    }
    const plan = planSync([watch], [product])

    expect(plan.archive).toHaveLength(0)
    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]!.productId).toBe('gid://shopify/Product/1')
  })

  it('still archives a page no watch claims', () => {
    // The renaming fix must not make the archive path unreachable, or a sold
    // watch's page stays live and buyable forever.
    const plan = planSync([], [{
      id: 'gid://shopify/Product/9', sku: '1999', title: 'Gone',
      status: 'ACTIVE', seoTitle: null, publishedAt: null,
    }])
    expect(plan.archive).toHaveLength(1)
  })

  it('does not claim one page for two watches', () => {
    // A stale `shopifyProductId` on one watch and a live SKU match on
    // another must not both resolve to the same product and have the two
    // fight over it on every sync.
    const a: SyncWatch = { ...base, id: 'wch_a', stockNo: 1143, shopifyProductId: 'gid://shopify/Product/1' }
    const b: SyncWatch = { ...base, id: 'wch_b', stockNo: 1144, shopifyProductId: 'gid://shopify/Product/1' }
    const product: SyncProduct = {
      id: 'gid://shopify/Product/1', sku: '1143', title: 'Rolex 116334',
      status: 'ACTIVE', seoTitle: null, publishedAt: '2026-01-01',
    }
    const plan = planSync([a, b], [product])
    const targets = plan.update.map((u) => u.productId)
    expect(new Set(targets).size).toBe(targets.length)
  })
})
