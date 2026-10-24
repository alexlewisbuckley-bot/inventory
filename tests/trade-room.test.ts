import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A second door into the same stock, for a different trade.
 *
 * The shop window at /s/<token> shows a reseller's customers the catalogue
 * photograph and the retail price. A dealer wants the opposite of both: the
 * photograph of the actual watch, taken on a desk with the papers beside it,
 * and no retail figure anywhere near the conversation — the number they pay
 * is the one agreed on the phone, and a price on the screen has already made
 * the first offer.
 *
 * Everything here is about the two rooms not leaking into each other. The
 * shop window is public by design; this one is not, and the whole of the
 * difference is a handful of clauses that no type checker can see.
 *
 * The behaviour was run against a real database and a real browser: the gate
 * refuses, an image URL on its own is a 404, a warranty card is a 404 even
 * with the passphrase, and the page carries no price anywhere. What is kept
 * here is everything provable without either.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('the door', () => {
  const service = read('src/server/services/reseller-service.ts')

  it('is not a door until it has both halves', () => {
    // A token with no passphrase is a public page showing trade photographs,
    // which is the one outcome this feature must not have. Issuing the token
    // and setting the passphrase are one act for exactly that reason.
    expect(service).toMatch(/if \(!row \|\| !row\.passwordHash\) return null/)
    const open = service.slice(service.indexOf('export async function setTradeAccess'))
    expect(open.slice(0, 1600)).toMatch(/tradeToken,\n\s+tradePasswordHash: await hashPassword/)
  })

  it('is closed by clearing both, not one', () => {
    // Either on its own leaves something that reads as working: a passphrase
    // guarding nothing, or a live-looking URL somebody will take as access.
    const close = service.slice(service.indexOf('export async function closeTradeRoom'))
    const body = close.slice(0, close.indexOf('export async function rotateTradeToken'))
    expect(body).toMatch(/tradeToken: null/)
    expect(body).toMatch(/tradePasswordHash: null/)
  })

  it('is never found by a hostname, only by its secret', () => {
    // The shop window accepts a hostname too, because a reseller may point
    // their own domain at it. A hostname cannot be a secret, and this door is
    // nothing but one.
    const door = service.slice(service.indexOf('export async function getTradeDoor'))
    const body = door.slice(0, door.indexOf('export async function getTradeRoom'))
    expect(body).not.toMatch(/matchesKey|checkDomain|customDomain/)
    expect(body).toMatch(/eq\(resellers\.tradeToken, token\)/)
  })

  it('asks for a passphrase somebody can say down a phone', () => {
    // The staff policy — uppercase, digit, no repeats — is the wrong test for
    // a secret that gets written on a pad and dictated. Length is the one
    // that survives being spoken.
    const open = service.slice(service.indexOf('export async function setTradeAccess'))
    expect(open.slice(0, 900)).toMatch(/length < 12/)
    expect(open.slice(0, 900)).not.toMatch(/assessPassword/)
  })

  it('stores it the way a staff password is stored', () => {
    // It is weaker in use, because a shared secret gets shared. That is no
    // reason for the stored form to be the weak part as well.
    expect(service).toMatch(/hashPassword\(value\)/)
    expect(read('src/app/actions/trade-room.ts')).toMatch(/verifyPassword\(passphrase, door\.passwordHash\)/)
  })

  it('answers the same for a wrong passphrase and a link that does not exist', () => {
    // Otherwise the form is a way of finding out which trade links are real.
    const action = read('src/app/actions/trade-room.ts')
    const wrong = (action.match(/That passphrase was not recognised/g) ?? []).length
    expect(wrong).toBe(1)
    expect(action).toMatch(/return wrong/)
    // And the no-such-door path does the work the real one would, so the two
    // cannot be told apart by how long they take.
    const missing = action.slice(action.indexOf('if (!door)'))
    expect(missing.slice(0, 300)).toMatch(/await verifyPassword/)
  })
})

describe('the pass a browser is given', () => {
  const pass = read('src/server/auth/trade-pass.ts')

  it('dies when the passphrase changes', () => {
    // Without this, "we changed the passphrase" is true on paper and false in
    // every browser that already holds a cookie.
    expect(pass).toMatch(/const fingerprint = \(token: string, passwordHash: string, setAt/)
    expect(pass).toMatch(/payload\.fp === fingerprint\(token, passwordHash, setAt\)/)
  })

  it('opens one room, not every room', () => {
    // Different dealers. A pass to one reseller's stock is not a pass to
    // another's, and a cookie named for the feature would hand over the
    // second room to whoever got into the first.
    expect(pass).toMatch(/\.setSubject\(token\)/)
    expect(pass).toMatch(/subject: token/)
    expect(pass).toMatch(/path: `\/t\/\$\{token\}`/)
  })

  it('does not put the secret from the URL into a cookie name', () => {
    expect(pass).toMatch(/createHash\('sha256'\)\.update\(token\)/)
    expect(pass).not.toMatch(/`osw_trade_\$\{token\}`/)
  })

  it('is httpOnly, and does not follow a link in from elsewhere', () => {
    expect(pass).toMatch(/httpOnly: true/)
    expect(pass).toMatch(/sameSite: 'strict'/)
  })
})

describe('what a dealer is shown', () => {
  const service = read('src/server/services/reseller-service.ts')
  const room = read('src/components/trade/TradeRoom.tsx')

  it('is only stock with a photograph of the actual watch', () => {
    // A dealer list exists to show the watch as it is. An entry with no
    // picture is a line of text claiming we have something, which is what a
    // spreadsheet is for and what this page replaces.
    const query = service.slice(service.indexOf('export async function getTradeRoom'))
    expect(query.slice(0, 2200)).toMatch(/EXISTS \(\n\s+SELECT 1 FROM watch_images i WHERE i\.watch_id = \$\{watches\.id\} AND i\.kind = 'TRADE'/)
  })

  it('is stock we could actually sell today', () => {
    // Through the shared predicate now, which adds the half this test was
    // never able to catch: in stock is not the same as in the building.
    // "In transit" is a location, not a status, so a watch being carried
    // between them stayed IN_STOCK and stayed on this list.
    const query = service.slice(service.indexOf('export async function getTradeRoom'))
    expect(query.slice(0, 2200)).toMatch(/\.\.\.onOffer\(\)/)

    const predicate = service.slice(service.indexOf('function onOffer()'))
    expect(predicate.slice(0, 400)).toMatch(/eq\(watches\.status, 'IN_STOCK'\)/)
    expect(predicate.slice(0, 400)).toMatch(/isNull\(watches\.deletedAt\)/)
    expect(predicate.slice(0, 400)).toMatch(/eq\(locations\.publishToStorefront, true\)/)
  })

  it('can be cut down by everything except money', () => {
    // The questions a dealer asks, and not one about price. Dial and who it
    // is worn by were missing from the first version — the two cuts anybody
    // browsing a case makes out loud, and the list was four controls that
    // could not express either.
    for (const label of ['Brand', 'Model', 'Dial', 'Worn by', 'Size', 'Year', 'Condition', 'Box & papers']) {
      expect(room, label).toContain(`label: '${label}'`)
    }
    expect(room).not.toMatch(/label: '(Budget|Price|Retail|Cost)'/)
  })

  it('leaves a midsize watch in both lists rather than picking one', () => {
    // 35 to 37mm is worn by anyone, and forcing a 36mm Datejust into one
    // list means never showing it to half the people it suits. The same
    // bands the stock list uses, so a dealer and the shop agree what a
    // midsize is — which is why one watch can answer a group twice, and why
    // the group test is `holds` rather than an equality.
    expect(room).toMatch(/if \(mm >= MENS_MIN_MM\) wears\.push\('MENS'\)/)
    expect(room).toMatch(/if \(mm <= WOMENS_MAX_MM\) wears\.push\('WOMENS'\)/)
    expect(room).toMatch(/function holds\(item: TradeItem, group: string, chosen: string\[\]\)/)
    expect(room).not.toMatch(/chosen\.includes\(valueOf\(item/)
  })

  it('offers a way into a long list', () => {
    // Thirty brands is a scroll and ninety models is a wall, and the chosen
    // ones pin to the top so narrowing never hides what is already picked.
    expect(room).toMatch(/options\.length > 8/)
    expect(room).toMatch(/matching\.filter\(\(option\) => chosen\.includes\(option\.value\)\)/)
  })

  it('counts each group under the others and never under itself', () => {
    // Choosing Rolex renarrows the models while the brand list still offers
    // Patek, because changing your mind is the next thing anybody does.
    expect(room).toMatch(/if \(other === group\.key \|\| chosen\.length === 0\) continue/)
  })

  it('hides a filter with only one answer', () => {
    // A control whose every answer is "everything" is chrome.
    expect(room).toMatch(/group\.options\.length > 1/)
  })

  it('shuts a filter on Escape', () => {
    // The dismissal sheet is a full-screen element. Left open after the one
    // gesture everybody tries first, the list underneath silently stops
    // taking clicks, which reads as the page having died.
    expect(room).toMatch(/event\.key === 'Escape'/)
  })
})

describe('the reseller’s own mark', () => {
  it('is found by the token the page actually carries', () => {
    // It reused the shop window's lookup, which matches the PUBLIC token or
    // the reseller's hostname. A trade URL carries neither, so it matched
    // nothing and the page drew a broken image next to the name.
    const route = read('src/app/t/[token]/logo/route.ts')
    expect(route).toMatch(/getTradeLogo\(params\.token\)/)
    expect(route).not.toMatch(/getShopLogo/)

    const service = read('src/server/services/reseller-service.ts')
    const logo = service.slice(service.indexOf('export async function getTradeLogo'))
    expect(logo.slice(0, 700)).toMatch(/eq\(resellers\.tradeToken, token\)/)
  })

  it('is not fixed by handing the dealer the shop window’s secret', () => {
    // The first fix on hand was to pass the public token through to the page
    // and build the URL from it. That would put the shop window's secret in
    // the markup of a page shown to dealers — the one audience with no
    // business holding it — which is worse than the broken image.
    for (const path of ['src/components/trade/TradeGate.tsx', 'src/components/trade/TradeRoom.tsx']) {
      expect(read(path), path).not.toMatch(/publicToken/)
    }
    expect(read('src/app/t/[token]/page.tsx')).not.toMatch(/publicToken/)
  })
})
