import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { IMAGE_KINDS, IMAGE_KIND_LABELS } from '@/lib/enums'

/**
 * Who is allowed to see which photograph.
 *
 * A watch carries four kinds of picture and they have three different
 * audiences. WATCH is published — Shopify, the website, a reseller's shop
 * window. TRADE is the same watch shot for the trade, and goes only to a
 * dealer signed in to the catalogue and to us. CARD and DOCUMENT never leave
 * at all: a warranty card carries a serial, a date and a dealer's stamp.
 *
 * None of that is enforceable in TypeScript, because every one of these is a
 * row in the same table and the difference is one short string. It is
 * enforced in the queries that serve the bytes, and a query that forgets is
 * not a type error, not a test failure, and not visible on the page that
 * leaks — it just quietly serves the wrong picture to the wrong person.
 *
 * So the queries are read here as text. The same move `sql-dialect.test.ts`
 * makes, for the same reason: the mistake is invisible everywhere else.
 *
 * This is not hypothetical. The reseller shop window asked for every
 * photograph a watch had, with no kind named at all, and a reseller's shop is
 * a public page.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

/**
 * Every raw `FROM watch_images` in the application, and the clause that
 * follows it.
 *
 * Deliberately crude. It is looking for the absence of a word, and the way to
 * be sure about an absence is to look at every occurrence rather than at the
 * ones somebody remembered to list.
 */
function rawImageSelects(source: string): string[] {
  return source.split(/FROM\s+watch_images/i).slice(1).map((rest) => rest.slice(0, 240))
}

describe('the doors that serve photographs outward', () => {
  it('lets the storefront fetch published photographs and nothing else', () => {
    // Shopify collects media from a URL, so this door opens with no session
    // at all. It is the narrowest one in the application and must stay so.
    const source = read('src/app/api/storefront-image/[id]/route.ts')
    expect(source).toMatch(/eq\(watchImages\.kind, 'WATCH'\)/)
  })

  it('names its kinds in every reseller query, whichever room it is for', () => {
    // This file serves two audiences from one table. The shop window is a
    // public page and gets WATCH; the trade room is behind a passphrase and
    // now gets both — it leads with the website photograph and offers the
    // trade shot behind a tap. What must never happen is a select with no
    // kind at all, which is the bug that prompted this file, when the shop
    // window asked for every photograph a watch had.
    //
    // So the rule is not "exactly one kind" any more — that was the shape
    // of the answer, not the question. It is "always a closed list, and
    // never CARD or DOCUMENT". A warranty card carries a serial, a date and
    // a dealer's stamp, and neither audience is owed one.
    const source = read('src/server/services/reseller-service.ts')

    const selects = rawImageSelects(source)
    expect(selects.length).toBeGreaterThan(0)
    for (const clause of selects) {
      const named = clause.match(/'(WATCH|TRADE|CARD|DOCUMENT)'/g) ?? []
      // Something, or the select is asking for every photograph a watch has.
      expect(named.length, clause.trim().slice(0, 90)).toBeGreaterThan(0)
      for (const kind of named) {
        expect(kind, clause.trim().slice(0, 90)).toMatch(/'(WATCH|TRADE)'/)
      }
    }

    // And the doors that hand over the bytes, each reachable with any id and
    // so unable to rely on the listing having offered only safe ones. The
    // shop window's stays a single kind; the trade door names its two.
    expect(source).toMatch(/eq\(watchImages\.kind, 'WATCH'\)/)
    expect(source).toMatch(/inArray\(watchImages\.kind, \['WATCH', 'TRADE'\]\)/)
    expect(source).not.toMatch(/'(CARD|DOCUMENT)'/)
  })

  it('puts the trade room behind its passphrase, not just behind its URL', () => {
    // The shop window's image route is guarded by the token alone, because
    // the pictures there are meant for the public and the token only decides
    // whose shop they belong to. The trade room's are the dealer's-eye
    // photographs: a route that served them on a URL alone would mean the
    // passphrase guarded the page and nothing on it, and a forwarded image
    // link would be the whole room.
    const route = read('src/app/t/[token]/image/[id]/route.ts')
    expect(route).toMatch(/hasTradePass\(params\.token/)
    expect(route).toMatch(/404/)

    // And the page itself loads no stock until somebody is through.
    const page = read('src/app/t/[token]/page.tsx')
    expect(page).toMatch(/if \(!inside\)/)
    // The call sites, not the imports: the catalogue query must come after
    // the check, or a wrong passphrase still costs a read of the whole room.
    expect(page.indexOf('await hasTradePass(')).toBeLessThan(page.indexOf('await getTradeRoom('))
  })

  it('never sends a price into the trade room', () => {
    // Not hidden by the component — never selected. A dealer pays what is
    // agreed on the phone, and a retail figure on the screen has already made
    // the first offer. A page cannot leak a number its query never asked for.
    const source = read('src/server/services/reseller-service.ts')
    const room = source.slice(source.indexOf('export async function getTradeRoom'))
    const body = room.slice(0, room.indexOf('export async function getTradeImage'))
    for (const money of ['estSaleGbp', 'tradePriceGbp', 'purchasePriceGbp', 'price']) {
      expect(body, money).not.toMatch(new RegExp(`\\b${money}\\b`))
    }
    // Nor does the shape it hands to the page have anywhere to put one.
    const shape = source.slice(source.indexOf('export interface TradeItem'))
    expect(shape.slice(0, shape.indexOf('}'))).not.toMatch(/price|Gbp/i)
  })

  it('pushes only published photographs to Shopify', () => {
    const source = read('src/server/services/shopify-service.ts')
    for (const clause of rawImageSelects(source)) {
      expect(clause, clause.trim().slice(0, 90)).toMatch(/i\.kind = 'WATCH'/)
    }
  })

  it('hands a trade login the trade shot, and not the paperwork', () => {
    // The one door a dealer's browser actually fetches from. It takes any id,
    // so it narrows by what the reader is rather than by what the page linked.
    const source = read('src/app/api/images/[id]/route.ts')
    expect(source).toMatch(/can\(user\.role, 'watch:read'\)/)
    expect(source).toMatch(/\['TRADE', 'WATCH'\]/)
  })

  it('shows a dealer the trade photograph, and never the paperwork', () => {
    const source = read('src/server/services/catalogue-service.ts')
    // Named in, rather than card and document named out: a kind added later
    // is then invisible here by default rather than published by default.
    expect(source).toMatch(/inArray\(watchImages\.kind, \['TRADE', 'WATCH'\]\)/)
    // And the trade shot is the one that wins where both exist.
    expect(source).toMatch(/watchImages\.kind\} <> 'TRADE'/)
  })
})

describe('what we see of our own stock', () => {
  it('offers the trade shot beside the published one, not instead of it', () => {
    // Both on every row, so the gallery's toggle is a change of mind rather
    // than a round trip — and so a watch with no trade shot can say so.
    const source = read('src/server/repositories/watch-repository.ts')
    expect(source).toMatch(/tradeImageId: sql<string \| null>/)
    expect(source).toMatch(/wi\.kind = 'TRADE'/)
    expect(source).toMatch(/primaryImageId: sql<string \| null>/)
  })

  it('does not fall back to the published photograph when asked for trade', () => {
    // Somebody turning the toggle on is checking which watches have been
    // shot for the trade. Answering with the other picture answers that
    // question with the one thing that looks like a yes.
    const gallery = read('src/components/inventory/InventoryGallery.tsx')
    expect(gallery).toMatch(/showTrade \? watch\.tradeImageId : watch\.primaryImageId/)
    expect(gallery).toMatch(/No trade shot/)
  })
})

describe('the kinds themselves', () => {
  it('carries a trade photograph as its own kind', () => {
    expect(IMAGE_KINDS).toContain('TRADE')
  })

  it('names every one of them', () => {
    // A kind with no label renders as nothing in the uploader, which looks
    // like a missing section rather than a missing string.
    for (const kind of IMAGE_KINDS) {
      expect(IMAGE_KIND_LABELS[kind], kind).toBeTruthy()
    }
    expect(Object.keys(IMAGE_KIND_LABELS).sort()).toEqual([...IMAGE_KINDS].sort())
  })

  it('offers somewhere to put one', () => {
    // The uploader builds its drop zones from a list, so a kind that is not
    // in that list can be stored but never uploaded.
    const gallery = read('src/components/inventory/ImageGallery.tsx')
    expect(gallery).toMatch(/kind: 'TRADE'/)
  })
})
