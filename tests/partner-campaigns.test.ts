import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CAMPAIGN_KINDS, CAMPAIGN_STATUSES } from '@/lib/enums'

const read = (path: string) => readFileSync(path, 'utf8')
const migration = read('src/server/db/migrations/0062_partner_campaigns.sql')
const service = read('src/server/services/partner-campaign-service.ts')
const action = read('src/app/actions/partner-campaigns.ts')
const choice = read('src/components/portal/RecipientChoice.tsx')
const list = read('src/components/portal/CampaignList.tsx')
const detail = read('src/components/portal/CampaignDetail.tsx')
const page = read('src/app/r/[token]/page.tsx')
const imageRoute = read('src/app/r/[token]/image/[id]/route.ts')
const campaignPage = read('src/app/p/[token]/campaigns/[id]/page.tsx')
const orders = read('src/server/services/partner-order-service.ts')
const held = read('src/components/reference/HeldStock.tsx')

/**
 * Reward campaigns a partner runs for its own people.
 *
 * Step three, and the reason the other two exist. Alex: "real estate companies
 * and corporate businesses that run incentives ... for purchasing, aquiring
 * and running incentives within their respective businesses."
 *
 * A company sets one up in its portal and sends each person a link. The person
 * picks a watch; we get a hold and a phone call to make. Everything below the
 * choosing is step two's machinery, which is the point — a campaign claim and
 * a partner's own order land in the same list and are released the same way.
 */

describe('the two kinds', () => {
  it('are a shortlist and a budget, and not points', () => {
    /*
     * A points scheme is a currency we would have to issue, price, expire and
     * account for, and none of that is a thing a watch dealer should be in the
     * middle of. Both of these resolve to the same act — one person, one
     * watch, one hold — which is why they share everything underneath.
     */
    expect(CAMPAIGN_KINDS).toEqual(['SHORTLIST', 'BUDGET'])
    // The columns, not the word: both files explain in prose why there are no
    // points, and a test forbidding the explanation asks for the reasoning to
    // be deleted.
    expect(migration).not.toMatch(/points_balance|points integer|credits integer/)
    expect(service).not.toMatch(/awardPoints|spendPoints|pointsFor/)
  })

  it('will not open a budget campaign with no amount on it', () => {
    /*
     * The filter that keeps a campaign inside its budget IS the budget. A
     * missing one filters nothing, and the screen would show every watch in
     * the building to somebody's sales assistant.
     */
    expect(service).toContain('function assertBudget')
    expect(service).toContain("if (!input.budgetBase || input.budgetBase <= 0)")
  })

  it('measures the budget against the partner price, not the asking price', () => {
    /*
     * Their rate is the arrangement. A 20,000 budget at 8% off should buy a
     * watch we ask 21,700 for; measuring the other way quietly hands back the
     * discount the company negotiated.
     */
    expect(service).toContain('row.priceGbp <= campaign.budgetBase')
    expect(migration).toContain('budget_base integer')
  })
})

describe('the link each person gets', () => {
  it('is personal, and the one door in this system with a single lock', () => {
    /*
     * Deliberate. The alternative is asking somebody's warehouse manager to
     * remember a passphrase to collect a gift they did not ask for, which is
     * how a reward scheme ends with half its recipients ringing HR. The token
     * is per person, so a forwarded link is traceable to whoever forwarded it.
     */
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS partner_campaign_recipients_token_idx')
    expect(service).toContain('function newRecipientToken')
    expect(service).toContain('randomBytes(24)')
  })

  it('opens nothing unless the campaign is actually running', () => {
    /*
     * A draft link that works is a half-built campaign sent out by accident; a
     * closed one still giving away stock is a campaign that never ended.
     */
    expect(service).toContain("if (row.status !== 'OPEN') return null")
    expect(CAMPAIGN_STATUSES).toEqual(['DRAFT', 'OPEN', 'CLOSED'])
  })

  it('answers an unknown, withdrawn or finished link the same way', () => {
    // Anything more specific tells whoever holds a dead link that there is
    // something real behind it.
    expect(page).toContain('if (!view) notFound()')
    expect(service).toContain('isNull(partnerCampaignRecipients.deletedAt)')
  })

  it('tells a link preview nothing', () => {
    /*
     * This goes out by email to a few dozen people who forward it to their
     * partners and paste it into group chats. A card reading "Choose your
     * watch · So-and-so" would announce the reward scheme in all of them.
     */
    expect(page).toContain('robots: { index: false, follow: false, nocache: true }')
    expect(page).toContain("title: 'Your choice'")
  })

  it('serves only photographs of watches that invitation offers', () => {
    /*
     * Otherwise the route is a way to read the whole photo library — warranty
     * cards included — by guessing at ids, from a link that was emailed to
     * somebody's entire sales floor.
     */
    expect(service).toContain('view.choices.some((choice) => choice.imageIds.includes(imageId))')
    expect(service).toContain("${watchImages.kind} = 'WATCH'")
    expect(imageRoute).toContain('getRecipientImage(params.token, params.id)')
  })
})

describe('choosing', () => {
  it('is checked against what the campaign offers, not against what was posted', () => {
    /*
     * Otherwise a budget campaign is a way to order any watch in the building
     * by editing one hidden field.
     */
    expect(service).toContain('const choice = view.choices.find((row) => row.id === watchId)')
    expect(service).toContain('if (!choice) throw new ValidationError')
  })

  it('is one watch each', () => {
    expect(service).toContain('if (view.recipient.claimedAt) throw new ConflictError')
    expect(service).toContain('claimedAt: new Date()')
  })

  it('goes through the same hold as any other partner order', () => {
    /*
     * The whole reason step two was built first. A claim and a partner's own
     * order end up in the same held-stock list, with the same release, rather
     * than a second kind of reservation that has to be found somewhere else.
     */
    expect(service).toContain('await db.insert(partnerOrders).values({')
    expect(service).toContain("status: 'RESERVED'")
    expect(service).toContain('campaignId: view.campaign.id')
    expect(service).toContain('recipientId: view.recipient.id')
  })

  it('re-reads the watch inside the transaction', () => {
    // Several people are looking at the same shortlist at the same time, which
    // is exactly the race a reward scheme creates on the morning it goes out.
    expect(service).toContain('await withTransaction')
    expect(service).toContain("watch.status !== 'IN_STOCK'")
  })

  it('names the person and the campaign in the audit, and no member of staff', () => {
    // There is no session here. Naming somebody would be a lie in the one log
    // that has to be literally true.
    expect(service).toContain('actorId: null')
    expect(service).toContain('chosen by ${view.recipient.name}')
  })

  it('tells our team', () => {
    expect(service).toContain("eq(users.role, 'OWNER')")
    expect(service).toContain("type: 'PARTNER_ORDER'")
  })
})

describe('what a recipient is shown', () => {
  it('puts prices on a budget campaign and not on a shortlist', () => {
    /*
     * On a budget they are the whole mechanic — you cannot spend an amount
     * without seeing what things cost. On a shortlist the employer has already
     * chosen what is on offer, so a price tag does two unhelpful things: it
     * puts a number on a gift, and it tells a few dozen employees what their
     * company negotiated with us.
     */
    expect(choice).toContain("const showPrices = campaign.kind === 'BUDGET'")
    expect(choice).toContain('{showPrices && (')
    expect(detail).toContain('Nobody sees a price')
  })

  it('is not a shop', () => {
    /*
     * The person reading it did not come to buy a watch; their employer told
     * them to pick one, and most will never have chosen a watch before. No
     * search, no sort, no filters, nothing to sign in to and nothing to pay.
     */
    // The controls, not the words — `.filter(Boolean)` is not a filter bar.
    expect(choice).not.toMatch(/placeholder="Search|SORTS|useMemo\(\(\) => \[\.\.\.new Set/)
    expect(choice).not.toContain('<select')
    expect(choice).toContain('nothing to pay')
  })

  it('still answers when they come back afterwards', () => {
    /*
     * Somebody clicking their link again a week later is checking they did it
     * right, and an empty page or a dead link is the worst possible answer.
     */
    expect(choice).toContain('recipient.claimedAt ?')
    expect(choice).toContain('Thank you')
    expect(service).toContain('chosen: chosen ?? null')
  })

  it('hides a piece somebody else has taken rather than marking it gone', () => {
    /*
     * The portal's rule, and here it matters more: a colleague's reward
     * showing as "reserved" tells one employee what another one chose.
     */
    expect(service).toContain("eq(watches.status, 'IN_STOCK')")
    expect(choice).not.toMatch(/Reserved|Taken|No longer available</)
  })
})

describe('running one', () => {
  it('will not open a campaign that would send out an empty page', () => {
    /*
     * The two ways a campaign goes out broken are both silent: a shortlist
     * with nothing on it, and a campaign with nobody to send it to. The person
     * who gets that link concludes the company forgot about them.
     */
    expect(service).toContain('Nobody is on this campaign yet')
    expect(service).toContain('There are no watches on this shortlist yet')
  })

  it('does not hold the whole shortlist', () => {
    /*
     * A row on a shortlist is a nomination, not a reservation. Holding them
     * all would take twenty watches off the market for a month to give away
     * three.
     */
    expect(migration).toContain('a nomination, not a reservation')
    expect(service).not.toMatch(/setShortlist[\s\S]{0,600}status: 'RESERVED'/)
  })

  it('does not release held stock when a campaign closes', () => {
    /*
     * Closing stops unclaimed links. A watch somebody chose last week stays
     * held — releasing it is a decision a person takes, with a reason, on the
     * list where it is visible.
     */
    const close = service.slice(service.indexOf('export async function closeCampaign'))
    expect(close.slice(0, 700)).not.toMatch(/IN_STOCK|releaseHold/)
  })

  it('will not quietly drop somebody who has already chosen', () => {
    // Their choice is a hold on a watch. Removing the person would leave that
    // hold with nothing explaining it.
    expect(service).toContain('They have already chosen. Release the hold instead.')
  })

  it('cannot reach another company’s campaign', () => {
    /*
     * A campaign id is guessable in a way a token is not, so every read and
     * every write is scoped by the partner behind the passphrase rather than
     * by the id in the URL.
     */
    // Checked in the lookup every other call goes through, not only in the
    // listing — a scoped list in front of an unscoped read is no scope at all.
    const lookup = service.slice(service.indexOf('export async function getCampaign'))
    expect(lookup.slice(0, 600)).toContain('eq(partnerCampaigns.partnerId, partnerId)')
    expect(campaignPage).toContain('getCampaign(door.id, params.id)')
  })

  it('checks the portal door on every campaign action', () => {
    /*
     * A server action is a route like any other, and these change what a
     * company's staff are offered and what stock leaves the market. Without
     * it, anybody holding the portal link could open a campaign, add
     * themselves to it and claim a watch.
     */
    expect(action).toContain('async function insideOrNull')
    /*
     * Seven: every action that changes a campaign. The eighth — claiming —
     * deliberately does not, because the recipient's own token IS the
     * invitation and they never see the portal's passphrase.
     */
    expect(action.match(/await insideOrNull\(token\)/g)).toHaveLength(7)
    const claimBlock = action.slice(action.indexOf('export async function claimAction'))
    expect(claimBlock).not.toContain('insideOrNull')
  })

  it('takes a pasted list rather than a form filled in forty times', () => {
    // The list already exists, in a spreadsheet or an email from a manager.
    expect(action).toContain(".split('\\n')")
    expect(detail).toContain('paste straight from a spreadsheet')
  })

  it('explains the two kinds at the moment of choosing between them', () => {
    // Somebody sets one of these up twice a year and will not have read
    // anything beforehand.
    expect(list).toContain('You pick the watches')
    expect(list).toContain('Everyone sees what they can afford at your rate')
  })

  it('shows who has not chosen yet', () => {
    // The question somebody opens this page for is always who is outstanding,
    // and a total on its own does not answer it.
    expect(list).toContain('of {campaign.recipientCount} chosen')
  })
})

describe('running one from our own system', () => {
  const staffPage = read('src/app/(app)/partners/[id]/page.tsx')
  const staffUi = read('src/components/reference/PartnerCampaigns.tsx')
  const manager = read('src/components/reference/PartnerManager.tsx')
  const partnersAction = read('src/app/actions/partners.ts')
  const portalService = read('src/server/services/partner-portal-service.ts')

  it('is reachable without a partner\u2019s portal link', () => {
    /*
     * Alex: "I cant see anywhere to run a campaign."
     *
     * They lived only behind a company's own link, which put them out of
     * reach of the people who actually sell these arrangements — and most
     * partners would rather we set theirs up anyway. An estate agency
     * rewarding fifteen staff does not want a login; it wants somebody here
     * to put the list in and send the links back.
     */
    expect(staffPage).toContain("requireCapability('partner:read')")
    expect(staffPage).toContain('listCampaigns(partner.id)')
    expect(staffUi).toContain('Reward campaigns')
  })

  it('is signposted from the partner card, not left to be guessed at', () => {
    // A card with nothing clickable on it is where somebody looks for this
    // and gives up.
    expect(manager).toContain('href={`/partners/${partner.id}`}')
    expect(manager).toContain('Set up a reward campaign')
  })

  it('uses the same service as the portal, so the two cannot drift', () => {
    /*
     * A campaign built here and one built in the portal are the same record.
     * A second implementation would be two screens quietly disagreeing about
     * what a company's staff were offered.
     */
    expect(partnersAction).toContain("from '@/server/services/partner-campaign-service'")
    expect(partnersAction).toContain('await openCampaign(partnerId, campaignId)')
    expect(partnersAction).toContain('await setShortlist(partnerId, campaignId, watchIds)')
  })

  it('is behind partner:manage rather than a passphrase', () => {
    /*
     * Every exported action in this file, not a count across it.
     *
     * A count passes while one action quietly loses its gate, and the one
     * that loses it is the one somebody edited last.
     */
    const exported = [...partnersAction.matchAll(/export async function (\w+)/g)].map((m) => m[1])
    expect(exported.length).toBeGreaterThanOrEqual(12)
    for (const name of exported) {
      const start = partnersAction.indexOf(`export async function ${name}`)
      const next = partnersAction.indexOf('\nexport async function', start + 1)
      const body = partnersAction.slice(start, next === -1 ? undefined : next)
      expect(body, `${name} must be gated`).toMatch(/requireCapability\('partner:(manage|read)'\)/)
    }
    const staffBlock = partnersAction.slice(partnersAction.indexOf('saveCampaignForPartnerAction'))
    expect(staffBlock).not.toContain('hasPortalPass')
  })

  it('can build a shortlist before a portal has been opened', () => {
    /*
     * The portal's own stock list answers through the door, which is right
     * for a page behind a passphrase and wrong for ours: somebody building a
     * shortlist for a company whose portal is not open yet would be shown
     * nothing, and would reasonably conclude there is no stock.
     */
    expect(portalService).toMatch(/export async function stockForPartner\(/)
    expect(staffPage).toContain('stockForPartner(partner.id)')
  })

  it('does not give the status and the button the same word', () => {
    // The chip already says OPEN. A button wearing the same word beside it
    // reads as a second label rather than as something to press.
    expect(staffUi).toContain("'Close it' : 'Open it'")
  })

  it('warns when nobody at the company can see their own campaigns', () => {
    // The recipients' links still work, so this is a note rather than an
    // error — but it is the question somebody will ask.
    expect(staffUi).toContain('This partner has no portal open')
  })
})

describe('on our side of it', () => {
  it('names the campaign on the held-stock list', () => {
    /*
     * The difference between "somebody at the company wants this" and "this is
     * Priya's ten-year award" changes how the phone call goes, and is not a
     * thing to make our side guess at.
     */
    expect(orders).toContain('campaignName: partnerCampaigns.name')
    expect(held).toContain('Reward · {row.campaignName}')
  })

  it('leaves the order nullable for a partner buying for itself', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS campaign_id text')
    expect(migration).toContain('ON DELETE SET NULL')
  })
})
