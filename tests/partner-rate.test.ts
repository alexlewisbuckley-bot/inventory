import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  MAX_DISCOUNT_BPS, RATE_PRECISION, bpsFromPercent, isUsableRate,
  partnerPrice, partnerSaving, percentFromBps,
} from '@/lib/partner-rate'
import { partnerSchema } from '@/lib/validation'
import { can } from '@/lib/permissions'

const read = (path: string) => readFileSync(path, 'utf8')
const migration = read('src/server/db/migrations/0060_partners_and_their_rates.sql')
const service = read('src/server/services/partner-service.ts')
const action = read('src/app/actions/partners.ts')
const manager = read('src/components/reference/PartnerManager.tsx')
const page = read('src/app/(app)/partners/page.tsx')
const stock = read('src/server/services/partner-stock.ts')
const nav = read('src/components/layout/nav-model.ts')

/**
 * Corporate partners, and the rate each one buys at.
 *
 * Alex: "build a model for real estate companies and corporate businesses
 * that run incentives to have a portal similar to the resellers for
 * purchasing, aquiring and running incentives within their respective
 * businesses ... they have access to preferential rates".
 *
 * This is the entity and the rate, staff-side. The portal those companies log
 * into and the campaigns they run sit on top of what is tested here, so the
 * arithmetic and the guard around the rate are worth pinning before anything
 * quotes from them.
 */

describe('what a partner pays', () => {
  it('takes the agreed percentage off the asking price', () => {
    // 8% off AED 120,000.00, in base minor units.
    expect(partnerPrice(12_000_000, 800)).toBe(11_040_000)
  })

  it('leaves a partner with no agreed rate at the asking price', () => {
    // Zero is a real state, not a missing one: a company set up before terms
    // are signed buys at retail until they are.
    expect(partnerPrice(12_000_000, 0)).toBe(12_000_000)
  })

  it('offers nothing for a watch nobody has priced', () => {
    /*
     * The failure this avoids is a discount off a blank.
     *
     * Treating an absent price as zero would quote the piece at nothing, and
     * a percentage of nothing is still nothing — so a watch that had simply
     * not been priced yet would read as free. Null makes the caller decide,
     * and the portal leaves it out.
     */
    expect(partnerPrice(null, 800)).toBeNull()
    expect(partnerPrice(undefined, 800)).toBeNull()
    expect(partnerSaving(null, 800)).toBeNull()
  })

  it('rounds rather than floors, so nothing is given away a line at a time', () => {
    // 7.55% off 1,000 is 924.5. A floor would hand over the half unit on
    // every line of every order, for no reason anybody wrote down.
    expect(partnerPrice(1_000, 755)).toBe(925)
  })

  it('says what the partner saved, and the two add back up', () => {
    const asking = 12_000_000
    const price = partnerPrice(asking, 850)
    const saving = partnerSaving(asking, 850)
    expect(price! + saving!).toBe(asking)
  })

  it('ignores a stored rate that cannot be right', () => {
    /*
     * A rate outside the usable range quotes at the asking price rather than
     * at whatever the bad number works out to.
     *
     * If a row ever carries 8,000 basis points — a migration, a script, a
     * hand-edited record — the choice is between quoting at a fifth of the
     * price and quoting at full price. Full price is the error somebody
     * notices and nobody loses money on.
     */
    expect(partnerPrice(12_000_000, 8_000)).toBe(12_000_000)
    expect(partnerPrice(12_000_000, -500)).toBe(12_000_000)
  })
})

describe('the ceiling on a rate', () => {
  it('stops half off and anything beyond it', () => {
    expect(isUsableRate(MAX_DISCOUNT_BPS)).toBe(true)
    expect(isUsableRate(MAX_DISCOUNT_BPS + 1)).toBe(false)
  })

  it('catches the typo it exists for', () => {
    /*
     * Somebody typing 80 where they meant 8.
     *
     * The two are a keystroke apart, both parse, and the wrong one reads as a
     * deliberate commercial decision on every order afterwards. This is the
     * only reason the ceiling exists — it is not a commercial rule, since a
     * corporate rate is single digits to the mid teens.
     */
    expect(bpsFromPercent('8')).toBe(800)
    expect(bpsFromPercent('80')).toBeNull()
  })

  it('refuses a fraction of a basis point', () => {
    // Hundredths of a percent are already finer than anybody negotiates, and
    // a float here would put rounding back into every price.
    expect(isUsableRate(812.5)).toBe(false)
  })

  it('is checked in the service as well as in the form', () => {
    /*
     * The form is one way in and the server action is reachable without it.
     *
     * A page that validates and a service that does not is a rate set by
     * anything that can post, which here means a partner quoted at a fifth of
     * the asking price on every order until somebody notices.
     */
    expect(service).toContain('function assertRate')
    expect(service).toContain('assertRate(input.discountBps)')
    // Both doors: creating a partner and editing one.
    expect(service.match(/assertRate\(input\.discountBps\)/g)).toHaveLength(2)
  })

  it('is checked in the schema the form parses through', () => {
    const base = {
      name: 'Meridian Estates', displayCurrency: 'AED',
      brandColor: '#04173A', accentColor: '#0F766E', isActive: 'true',
    }
    expect(partnerSchema.safeParse({ ...base, discountPercent: '8.5' }).success).toBe(true)
    expect(partnerSchema.safeParse({ ...base, discountPercent: '80' }).success).toBe(false)
    expect(partnerSchema.safeParse({ ...base, discountPercent: '-2' }).success).toBe(false)
  })
})

describe('a rate as somebody types it', () => {
  it('takes what people actually write', () => {
    expect(bpsFromPercent('8')).toBe(800)
    expect(bpsFromPercent('8.5')).toBe(850)
    expect(bpsFromPercent(' 8.5 % ')).toBe(850)
    expect(bpsFromPercent('0')).toBe(0)
  })

  it('reports anything that is not a rate rather than guessing at one', () => {
    // Null travels back to the form as an error. Rounding "eight" to 8% would
    // be a price set by a parser.
    expect(bpsFromPercent('')).toBeNull()
    expect(bpsFromPercent('eight')).toBeNull()
    expect(bpsFromPercent('--')).toBeNull()
  })

  it('reads back the way it was said', () => {
    expect(percentFromBps(800)).toBe('8%')
    expect(percentFromBps(850)).toBe('8.5%')
    expect(percentFromBps(0)).toBe('0%')
  })

  it('converts percent to basis points in exactly one place', () => {
    /*
     * Two conversions is two rounding rules.
     *
     * The action turns the typed percentage into the integer and everything
     * downstream takes the integer, so there is one answer to "what is 8.5%"
     * rather than one per caller.
     */
    expect(action).toContain('discountBps: Math.round(input.discountPercent * 100)')
    /*
     * The RATE conversion, named rather than counted.
     *
     * This used to count every `* 100` in the file, which held until a reward
     * campaign's budget arrived — whole currency units to minor units, a
     * different quantity that happens to share a factor. Counting was a proxy
     * for "one rule for turning a typed percentage into basis points", and
     * that is what is asserted now.
     */
    expect(action.match(/discountPercent \* 100/g)).toHaveLength(1)
    expect(action).not.toMatch(/discountPercent \* 100[\s\S]*discountPercent \* 100/)
  })
})

describe('the price is worked out, never stored', () => {
  it('keeps no partner price column', () => {
    /*
     * A stored partner price is a second copy of the truth.
     *
     * It goes stale the first time somebody adjusts a watch and forgets the
     * price lists hanging off it — and the stale copy is the one a partner is
     * quoted from. The rate lives on the partner, the price is derived when it
     * is read, so repricing a watch moves every partner's price with it.
     */
    expect(migration).toContain('discount_bps integer NOT NULL DEFAULT 0')
    expect(migration).not.toMatch(/partner_price|price_gbp|partner_prices/)
  })

  it('stores the rate as an integer', () => {
    // Integer arithmetic has no rounding of its own, which matters for a
    // number that multiplies every price a partner is ever quoted.
    expect(migration).toContain('discount_bps integer')
    expect(RATE_PRECISION).toBe(10_000)
  })

  it('frees the name when a partner is removed', () => {
    // Soft delete, because a partner will own orders and campaigns and a hard
    // one would take the record of what they bought with it. The partial index
    // lets a company come back under new terms.
    expect(migration).toContain('ON partners (slug) WHERE deleted_at IS NULL')
    expect(service).toContain('deletedAt: new Date()')
  })
})

describe('who may set a rate', () => {
  it('sits with managers and the owner, like resellers', () => {
    // The other kind of outside organisation this business deals with is
    // judged the same way, and a rate is a commercial term.
    expect(can('MANAGER', 'partner:manage')).toBe(true)
    expect(can('OWNER', 'partner:manage')).toBe(true)
  })

  it('is not something a salesperson can quietly change', () => {
    expect(can('SALES', 'partner:manage')).toBe(false)
    expect(can('OPERATIONS', 'partner:manage')).toBe(false)
    expect(can('VIEWER', 'partner:read')).toBe(false)
  })

  it('gates the action and the page on the capability', () => {
    expect(action).toContain("requireCapability('partner:manage')")
    expect(page).toContain("requireCapability('partner:read')")
    expect(nav).toContain("capability: 'partner:read'")
  })
})

describe('a change of rate is named in the audit', () => {
  it('records the figure it moved from and to', () => {
    /*
     * "The partner was edited" does not say whose margin moved or by how much.
     *
     * Every other field on a partner is contact detail somebody can see is
     * wrong by looking at it. A rate decides what a company pays on every
     * order, and the question asked afterwards is always what it used to be.
     */
    expect(service).toContain('discountBps: { from: before.discountBps, to: input.discountBps }')
    expect(service).toContain('moved from ${before.discountBps / 100}% to ${input.discountBps / 100}% off')
  })
})

describe('the rate on screen', () => {
  it('shows what it is worth against a real asking price', () => {
    /*
     * Alex, on the last screen built here: "this interface is shocking."
     *
     * A percentage in a field is abstract at the moment it is being agreed. A
     * price somebody recognises, with the partner's price beside it, is the
     * thing being decided — and a mistyped rate is obvious rather than
     * plausible.
     */
    expect(manager).toContain('partnerPrice(sampleAsking, partner.discountBps)')
    expect(manager).toContain('is{\' \'}')
    expect(page).toContain('sampleAskingPrice()')
  })

  it('leaves the panel out when nothing priced is in stock', () => {
    // Rather than demonstrating the rate against a figure nobody chose.
    expect(manager).toContain('sampleAsking !== null && partner.discountBps > 0')
    expect(stock).toContain('isNotNull(watches.estSaleGbp)')
    expect(stock).toContain('return row?.estSaleGbp ?? null')
  })

  it('samples only stock that is actually here', () => {
    expect(stock).toContain("eq(watches.status, 'IN_STOCK')")
    expect(stock).toContain('isNull(watches.deletedAt)')
  })
})
