import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PARTNER_ORDER_STATUSES, PARTNER_ORDER_STATUS_LABELS } from '@/lib/enums'
import { partnerPrice } from '@/lib/partner-rate'
import { can } from '@/lib/permissions'

const read = (path: string) => readFileSync(path, 'utf8')
const migration = read('src/server/db/migrations/0061_partner_portal_and_orders.sql')
const service = read('src/server/services/partner-portal-service.ts')
const orders = read('src/server/services/partner-order-service.ts')
const action = read('src/app/actions/partner-portal.ts')
const staffAction = read('src/app/actions/partners.ts')
const page = read('src/app/p/[token]/page.tsx')
const imageRoute = read('src/app/p/[token]/image/[id]/route.ts')
const room = read('src/components/portal/PortalRoom.tsx')
const gate = read('src/components/portal/PortalGate.tsx')
const held = read('src/components/reference/HeldStock.tsx')
const partnersPage = read('src/app/(app)/partners/page.tsx')
const doorPass = read('src/server/auth/door-pass.ts')
const portalPass = read('src/server/auth/portal-pass.ts')

/**
 * The partner portal: the door a company comes through, and what happens when
 * they take something.
 *
 * Alex: "a portal similar to the resellers for purchasing, aquiring and
 * running incentives within their respective businesses." Step two of three.
 * The door is the trade room's, because it is the same problem and that one
 * has already met reality; what is new here is a price per company and an
 * order that takes a watch off the market.
 */

describe('the door', () => {
  it('is a token and a passphrase, not an account', () => {
    /*
     * The people using this are buyers at another company.
     *
     * Giving them user rows would mean a role, a password reset flow and a
     * seat in this system for somebody who needs to look at a list twice a
     * month — and every one of those is a thing that can be got wrong in a
     * way that reaches our stock.
     */
    expect(migration).toContain('portal_token text')
    expect(migration).toContain('portal_password_hash text')
    expect(service).toContain('hashPassword(value)')
    expect(service).not.toMatch(/insert\(users\)/)
  })

  it('opens nothing until both halves exist', () => {
    /*
     * Issuing a token and setting a passphrase are two steps, and between
     * them the link must open nothing. Otherwise the gap is a public page
     * showing live stock and what we are prepared to take for it.
     */
    expect(service).toContain('if (!row || !row.passwordHash) return null')
  })

  it('answers a bad passphrase and a dead link the same way', () => {
    // Otherwise this is a way to find out which partner links are real.
    expect(action).toContain("message: 'That passphrase was not recognised.'")
    const missing = action.slice(action.indexOf('if (!door)'))
    expect(missing.slice(0, 300)).toMatch(/await verifyPassword/)
  })

  it('is a different door from the trade room', () => {
    // Different companies, different stock, different prices. A shared cookie
    // is the only thing needed to hand one of them the other's.
    expect(portalPass).toContain("prefix: 'osw_portal'")
    expect(portalPass).toMatch(/path: \(token\) => `\/p\/\$\{token\}`/)
  })

  it('shares one implementation with the trade room rather than a copy', () => {
    /*
     * Two copies of a sign-in dance is how the browser harnesses drifted —
     * one waiting for the wrong event, another hard-coding a path that moved.
     * A second copy of THIS one would drift in a place where drifting means
     * somebody stays signed in after a passphrase changes.
     */
    expect(portalPass).toContain("from './door-pass'")
    expect(read('src/server/auth/trade-pass.ts')).toContain("from './door-pass'")
    expect(doorPass).toMatch(/payload\.fp === fingerprint\(token, passwordHash, setAt\)/)
  })

  it('does not let a forwarded image link be the whole room', () => {
    // The passphrase has to guard the pictures as well as the page, or it
    // guards the page and nothing on it.
    expect(imageRoute).toContain('hasPortalPass(params.token')
    expect(imageRoute).toContain("'X-Robots-Tag': 'noindex, nofollow'")
    expect(imageRoute).toContain("'Cache-Control': 'private, max-age=3600'")
  })

  it('does not cost a stock query to answer a wrong passphrase', () => {
    expect(page.indexOf('await hasPortalPass(')).toBeLessThan(page.indexOf('await getPortalRoom('))
  })

  it('tells a search engine and a link preview nothing', () => {
    expect(page).toContain('robots: { index: false, follow: false, nocache: true }')
    expect(page).toContain("title: 'Partner access'")
  })
})

describe('what a partner is shown', () => {
  it('leaves held stock out entirely rather than marking it taken', () => {
    /*
     * Alex: "Competative landscape doesn't work as it could be held by a
     * retail customer so it should just dissapear if held / reserved."
     *
     * A hold says nothing about partner demand — it is just as likely a
     * walk-in with a deposit down — so a portal that showed "reserved" would
     * be inventing a story about scarcity out of our own shop floor.
     */
    expect(service).toContain("eq(watches.status, 'IN_STOCK')")
    expect(service).not.toMatch(/'RESERVED'[^\n]*onOffer|status IN \('IN_STOCK', 'RESERVED'/)
    expect(room).not.toMatch(/Reserved by|Taken|On hold for another/)
  })

  it('leaves out stock nobody has priced', () => {
    // A watch with no asking price cannot be discounted into one, and quoting
    // off a blank is how a piece leaves at a number nobody chose.
    expect(service).toContain('${watches.estSaleGbp} IS NOT NULL')
  })

  it('works the price out from the rate rather than reading one back', () => {
    // The floor travels with it now: the rate decides the price until it
    // would go below what another dealer is quoted, and then the trade price
    // does.
    expect(service).toContain('partnerPrice(row.askingGbp, door.discountBps, row.tradeGbp)')
  })

  it('shows them their own holds, so the portal has not eaten them', () => {
    /*
     * A partner reserves a watch and it vanishes from the list — which is the
     * rule above working. Without their own orders beside it, the page reads
     * as having swallowed the thing they just asked for.
     */
    expect(service).toContain('.from(partnerOrders)')
    expect(room).toContain('On hold for you')
    /*
     * Held now means the order says so AND the watch agrees. The order was
     * once the only word on it, and the two drifted the moment a watch came
     * off hold by any route but the Release button — leaving a partner told a
     * piece was theirs while it was back on sale to everybody.
     */
    expect(room).toContain("order.status === 'PLACED' && order.watchStatus === 'RESERVED'")
  })

  it('shows words rather than the values we store', () => {
    /*
     * A partner reading "BOX_ONLY" under a watch is being shown the inside of
     * a database. "Not recorded" is dropped as well: on a page that is
     * selling something, a line admitting we did not write it down adds
     * nothing a blank does not already say.
     */
    expect(room).toContain('BOX_PAPERS_LABELS[item.boxPapers as BoxPapers]')
    expect(room).toContain("item.boxPapers !== 'UNKNOWN'")
    expect(room).toContain('CONDITION_LABELS[item.condition as Condition]')
  })

  it('never shows a trade photograph', () => {
    /*
     * Alex: "do not use any trade images what so ever."
     *
     * A trade shot is a record picture — taken to prove a piece is in hand,
     * marks and all, on whatever surface was nearest. A dealer wants exactly
     * that. A partner is buying the watch for somebody's wrist, and a page
     * asking a negotiated price with a record picture on it undercuts the
     * price it is asking.
     */
    expect(service).toContain("i.kind = 'WATCH'")
    expect(service).not.toMatch(/kind IN \('WATCH', 'TRADE'\)/)
    expect(service).toContain("${watchImages.kind} = 'WATCH'")
  })

  it('lists nothing it cannot show a photograph of', () => {
    /*
     * Asked for in the query rather than filtered afterwards, so the count on
     * the page and the rows on the page agree. A card reading "no photograph"
     * is a line of text claiming we have something, and a partner cannot
     * judge a watch from it anyway.
     */
    expect(service).toContain('sql`EXISTS (\n        SELECT 1 FROM watch_images i')
  })

  it('can be filtered the way any shop can', () => {
    /*
     * Two hundred watches is past the point where a list is browsable. Alex:
     * "add filtering like it is any other website to find watch easily."
     *
     * The choices come from the stock rather than from a fixed list: a brand
     * filter offering Patek when there is none in the building returns
     * nothing, which reads as the page being broken rather than as us not
     * having one.
     */
    expect(room).toContain('const brands = useMemo')
    expect(room).toContain('[...new Set(items.map((item) => item.brandName))]')
    expect(room).toContain('item.priceGbp < floor')
    expect(room).toContain('item.priceGbp > ceiling')
    expect(room).toContain("if (sort === 'priceUp')")
  })

  it('lays out five to a row with cards that cannot go ragged', () => {
    /*
     * One watch called "Royal Oak Offshore Chronograph" would otherwise drop
     * the button on its card below the four beside it, and the row reads as
     * broken.
     */
    expect(room).toContain('xl:grid-cols-5')
    expect(room).toContain('flex h-full flex-col')
    expect(room).toContain('line-clamp-2 min-h-[2.6em]')
    expect(room).toContain('line-clamp-1 min-h-[1.3em]')
  })

  it('states the rate once rather than badging every row', () => {
    // A page that says "8.5% off" forty times reads as a sale. This is not a
    // sale; it is what this company always pays.
    expect(room).toContain('off our asking price')
    expect(room.match(/percentFromBps/g)).toHaveLength(2)
  })
})

describe('taking one off the market', () => {
  it('checks the watch again at the moment of the order', () => {
    /*
     * The list was true when it rendered. Between then and the button there
     * is a walk-in, another partner, and anybody on the shop floor marking
     * the piece sold — and the whole purpose of a hold is that the second
     * person to ask is told no.
     */
    expect(service).toContain("if (watch.status !== 'IN_STOCK')")
    expect(service).toContain('That watch has just gone')
  })

  it('cannot promise one watch to two companies', () => {
    /*
     * In the database, not in a check. Two partners reserving the same piece
     * seconds apart is a race that reading-then-writing does not win, and the
     * losing half of it is a watch sold twice.
     */
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS partner_orders_live_watch_idx')
    expect(migration).toContain("ON partner_orders (watch_id) WHERE status = 'PLACED'")
  })

  it('puts the watch on hold and says who for', () => {
    expect(service).toContain("status: 'RESERVED'")
    expect(service).toContain('(partner order)')
  })

  it('attributes the audit to nobody rather than to a member of staff', () => {
    /*
     * There is no session here. Naming a person would be a lie in the one log
     * that has to be literally true, and the company's name is the fact that
     * actually answers "who did this".
     */
    expect(service).toContain('actorId: null')
    expect(service).toContain('held for ${door.name}')
  })

  it('checks the pass in the action as well as on the page', () => {
    /*
     * A server action is a route like any other. Without this the passphrase
     * guards the list and nothing on it, and anybody holding the link could
     * take stock off the market without ever getting through the door.
     */
    expect(action).toContain('await hasPortalPass(token, door.passwordHash, door.passwordSetAt)')
  })

  it('takes no money and says so', () => {
    /*
     * No card, no checkout, no integration. An order here is a hold and a
     * phone call; the invoice is raised on this side the ordinary way, which
     * is also where the money is actually agreed.
     */
    expect(room).toContain('Nothing is charged')
    expect(service).not.toMatch(/stripe|paypal|checkout\.|chargeCard|takePayment/i)
  })
})

describe('what an order remembers', () => {
  it('keeps the price that was agreed, not a live one', () => {
    /*
     * This is not the stored partner price the rate deliberately avoids. That
     * would be a price kept alongside a live one, which goes stale and then
     * quotes a figure we no longer offer. This is history: what was promised
     * at a moment that has already happened, and repricing the watch
     * afterwards must not move it.
     */
    expect(migration).toContain('asking_at_order integer NOT NULL')
    expect(migration).toContain('discount_bps_at_order integer NOT NULL')
    expect(migration).toContain('price_at_order integer NOT NULL')
    expect(service).toContain('askingAtOrder: watch.askingGbp')
    expect(service).toContain('discountBpsAtOrder: door.discountBps')
  })

  it('agrees with the arithmetic the page quoted', () => {
    // The same function on both sides, so what somebody clicked and what gets
    // written down cannot be two different numbers.
    expect(partnerPrice(12_000_000, 850)).toBe(10_980_000)
    expect(service).toContain('partnerPrice(watch.askingGbp, door.discountBps, watch.tradeGbp)')
  })
})

describe('a hold ends when a person ends it', () => {
  it('has no expiry anywhere', () => {
    /*
     * Alex: "If they reserve the watches they should go on hold and we have a
     * way to retract them if payment isn't made manually."
     *
     * A hold that aged out on its own would put a watch back on offer in the
     * middle of a conversation nobody here knew was still running — and the
     * piece would be sold twice before anybody noticed it had come back.
     */
    expect(PARTNER_ORDER_STATUSES).not.toContain('EXPIRED')
    // The column, not the word: the migration's own comment says why there is
    // no expiry, and a test that forbade the explanation would be asking for
    // the reasoning to be deleted.
    expect(migration).not.toMatch(/expires_at|expires timestamptz/)
    expect(orders).not.toMatch(/expires_at|setTimeout|cron/)
  })

  it('reads as a hold on the screen, because that is the word on the stock', () => {
    expect(PARTNER_ORDER_STATUS_LABELS.PLACED).toBe('On hold')
  })

  it('shows what is held, for whom and since when', () => {
    // A hold that never expires needs somewhere it is visible and ageing, or
    // a watch sits off the market for six weeks because a thread went quiet.
    expect(held).toContain('On hold for a partner')
    expect(held).toContain('function daysSince')
    expect(orders).toContain('.orderBy(partnerOrders.placedAt)')
  })

  it('puts that list above the register, not below it', () => {
    expect(partnersPage.indexOf('<HeldStock')).toBeLessThan(partnersPage.indexOf('<PartnerManager'))
  })

  it('returns the watch to stock, in the same transaction as the release', () => {
    /*
     * A released order over a reserved watch is a piece nobody can sell and
     * nobody can see the reason for; a watch back in stock under a live order
     * sells twice.
     */
    expect(orders).toContain('await withTransaction')
    expect(orders).toContain("status: 'RELEASED'")
    expect(orders).toContain("set({ status: 'IN_STOCK'")
  })

  it('does not un-sell a watch that moved on in the meantime', () => {
    // Being sold is the happy ending for a hold, not a conflict — and forcing
    // IN_STOCK would undo an invoice somebody has already raised.
    expect(orders).toContain("if (row.status === 'RESERVED')")
  })

  it('tells our team, not the partner', () => {
    /*
     * Alex was explicit. A company sitting on a hold for three weeks gets a
     * phone call from somebody here, not an automated email informing them
     * their reservation has lapsed.
     */
    expect(orders).toContain("eq(users.role, 'OWNER')")
    /*
     * Nothing leaves this building when a hold is released. The buyer's email
     * IS carried through to the held-stock list — that is how somebody here
     * rings the right person — but it is never written to, from here or from
     * the portal service.
     */
    expect(orders).not.toMatch(/sendMail\(|sendWhatsApp\(/)
    expect(service).not.toMatch(/sendMail\(/)
    expect(held).toContain('placedByEmail')
  })

  it('does not notify whoever just did it', () => {
    // Nobody needs telling what they did ten seconds ago, and an owner
    // working through a list of stale holds would otherwise be notifying
    // themselves once per release.
    expect(orders).toContain('if (person.id === notice.exceptUserId) continue')
    expect(orders).toContain('exceptUserId: actor.id')
  })
})

describe('a hold and its watch cannot drift apart', () => {
  const sync = read('src/server/services/partner-hold-sync.ts')
  const watchService = read('src/server/services/watch-service.ts')
  const orders = read('src/server/services/partner-order-service.ts')

  it('closes the order wherever the watch moves', () => {
    /*
     * Alex: "I removed this from hold and synced but still shows as on hold
     * on Partner portal."
     *
     * He was right and the portal was wrong. The order carried its own status
     * and the portal read that alone, so taking the watch off hold by any
     * route but the Release button left the order saying PLACED for ever —
     * the piece back on sale to everybody while the company that reserved it
     * was still being told it was theirs.
     */
    expect(sync).toContain('export async function closeHoldsForWatch')
    expect(watchService).toContain('await closeHoldsForWatch(id, status, actor.id, watch.stockNo)')
    expect(watchService).toContain("await closeHoldsForWatch(watch.id, 'SOLD', actor.id, watch.stockNo)")
  })

  it('leaves a hold alone while the watch is still held', () => {
    // A watch arriving at or staying at RESERVED is not a release.
    expect(sync).toContain("if (newStatus === 'RESERVED') return")
  })

  it('closes a sold one as sold, not as released', () => {
    /*
     * A partner order that ends in a sale is the happy ending. Filing it as
     * "released" would read on the campaign screen as somebody changing their
     * mind, which is a different conversation from the one that happened.
     */
    expect(sync).toContain("const completed = newStatus === 'SOLD'")
    expect(sync).toContain("completed ? 'COMPLETED' : 'RELEASED'")
  })

  it('says in the audit why the order closed', () => {
    // Otherwise a partner asks why their hold went and nobody can answer.
    expect(sync).toContain('so the partner order was released with it')
    expect(sync).toContain('so the partner order closed with it')
  })

  it('heals a row that drifted before any of this existed', () => {
    /*
     * The write path only helps from now on. Both screens check the watch as
     * well as the order, so a row that already drifted stops claiming the
     * watch the moment anybody loads the page — without anybody running
     * anything against the database.
     */
    expect(service).toContain('watchStatus: watches.status')
    expect(room).toContain("order.watchStatus === 'RESERVED'")
    expect(orders).toContain("eq(watches.status, 'RESERVED')")
  })
})

describe('who may do any of this', () => {
  it('keeps the portal and the holds behind partner:manage', () => {
    /*
     * Releasing a hold is a commercial decision about a company we have an
     * arrangement with, not a stock movement, so it sits with whoever could
     * have agreed the hold rather than with anyone who can edit a watch.
     */
    expect(staffAction.match(/requireCapability\('partner:manage'\)/g)?.length).toBeGreaterThanOrEqual(6)
    expect(can('MANAGER', 'partner:manage')).toBe(true)
    expect(can('SALES', 'partner:manage')).toBe(false)
  })

  it('shows the passphrase once and never reads it back', () => {
    /*
     * It is stored hashed, so the dialog that set it is the only moment the
     * link and the word exist in the same place. It stays open with both on
     * screen rather than closing with a toast — a toast that vanishes after
     * four seconds is how somebody sets a second passphrase ten minutes
     * later.
     */
    const manager = read('src/components/reference/PartnerManager.tsx')
    expect(manager).toContain('cannot be shown again')
    expect(service).not.toMatch(/select[^\n]*portalPassword(?!Hash|SetAt)/)
  })

  it('closes both halves of the door at once', () => {
    // Clearing the token alone leaves a passphrase guarding nothing; clearing
    // the passphrase alone leaves a live-looking URL that opens nothing — and
    // somebody would read that URL existing as the access existing.
    expect(service).toContain('portalToken: null')
    expect(service).toContain('portalPasswordHash: null')
    expect(service).toContain('portalPasswordSetAt: null')
  })

  it('does not put the token in the page body', () => {
    // The browser already has it — it is in the address bar — but a hidden
    // input would also put it where a copied snippet of markup carries the
    // door with it.
    expect(gate).toContain('enterPortalAction.bind(null, token)')
    expect(gate).not.toMatch(/type="hidden"[^>]*token/)
  })
})
