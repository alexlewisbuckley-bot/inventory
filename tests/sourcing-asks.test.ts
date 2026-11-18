import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { pickBrand } from '@/server/services/sourcing-requests'

const read = (path: string) => readFileSync(path, 'utf8')

const service = read('src/server/services/sourcing-requests.ts')
const actions = read('src/app/actions/sourcing-requests.ts')
const repository = read('src/server/repositories/crm-repository.ts')
const insights = read('src/server/services/insights-service.ts')
const migration = read('src/server/db/migrations/0075_requests_from_the_portal.sql')
const board = read('src/app/(app)/requests/page.tsx')
const cta = read('src/components/portal/AskForWatch.tsx')

/**
 * Asks raised from outside.
 *
 * Alex: "We also need to add a sourcing request CTA that is easily visable for
 * agents and procurers in case we don't have the exact watch or item they are
 * looking for."
 *
 * Two audiences, one board. What follows is mostly about that: the ask has to
 * land where the procurers already work, and it has to be clear who it came
 * from without inventing a customer record for them.
 */
describe('a sourcing request from a partner', () => {
  it('goes on the board that already exists', () => {
    // An inbox of its own would be a second list of what we are looking for,
    // and the second one is the one nobody opens.
    expect(service).toContain('watchRequests')
    expect(service).not.toMatch(/CREATE TABLE|pgTable\(/)
  })

  it('belongs to somebody, even without a customer', () => {
    /*
     * The column assumed whoever wants a watch is a customer of ours. A
     * broker's agent is not, and a stub customer record for each of them
     * would be a CRM full of people nobody has met. So: nullable, plus a
     * check that keeps a request from belonging to nobody at all.
     */
    expect(migration).toContain('ALTER TABLE watch_requests ALTER COLUMN customer_id DROP NOT NULL')
    expect(migration).toContain('CHECK (customer_id IS NOT NULL OR partner_id IS NOT NULL)')
  })

  it('does not vanish from the board it was raised on', () => {
    /*
     * Both of these read requests through the customer. Left alone as inner
     * joins, an ask with no customer row behind it would be written, counted
     * in the sidebar, and invisible on the two screens that matter.
     */
    expect(repository).toContain('.leftJoin(customers, eq(customers.id, watchRequests.customerId))')
    expect(repository).not.toContain('.innerJoin(customers, eq(customers.id, watchRequests.customerId))')
    expect(insights).not.toContain('.innerJoin(customers, eq(customers.id, watchRequests.customerId))')
  })

  it('says who asked, where there is no customer to link to', () => {
    // Otherwise the row on the procurers' board reads as having come from
    // nobody, which is the fastest way to a queue people stop trusting.
    expect(board).toContain('request.agentName ?? request.askedByName')
    expect(board).toContain('at {request.partnerName}')
  })

  it('takes the agent’s name from their link, not from the form', () => {
    // A name in a payload is a thing anybody can change, and an ask filed
    // under somebody else is worse than an anonymous one.
    const fn = service.slice(service.indexOf('export async function askFromAgent'))
    expect(fn.slice(0, 1200)).toContain('askedByName: agent.name')
  })

  it('cannot set what it is worth chasing, or who chases it', () => {
    /*
     * An ask arrives OPEN, unowned and at normal priority. Who picks it up
     * and what it is worth are ours to decide — a form on a partner's phone
     * should not be able to raise itself to URGENT or put a name against it.
     */
    const fn = service.slice(service.indexOf('async function raise'), service.indexOf('export async function askFromPortal'))
    expect(fn).toContain("status: 'OPEN'")
    expect(fn).toContain("priority: 'NORMAL'")
    expect(fn).not.toContain('input.status')
    expect(fn).not.toContain('input.priority')
    expect(fn).not.toContain('input.ownerId')
    /*
     * It does name an owner, and not from the form: whoever set this partner
     * up. An ask with no owner is one nobody is told about when the watch
     * turns up, because the notice is written to the owner — and the asks
     * from outside are the ones we have least other contact about.
     */
    expect(fn).toContain('ownerId: partner?.ownerId ?? null')
  })

  it('puts the company’s ask behind the passphrase and the agent’s behind their link', () => {
    /*
     * Without a door on the portal one, anybody holding a partner's link
     * could fill the procurement board with work. The agent's link is the
     * door for theirs, as it is for their other two writes.
     */
    const portal = actions.slice(actions.indexOf('export async function askFromPortalAction'))
    expect(portal.slice(0, 700)).toContain('await hasPortalPass(token, door.passwordHash, door.passwordSetAt)')
    const agent = actions.slice(actions.indexOf('export async function askFromAgentAction'))
    expect(agent).not.toContain('hasPortalPass')
    expect(agent).toContain('askFromAgent(token, input)')
  })

  it('files it under a brand where the words name one', () => {
    // So the ask arrives sortable and the matching query can find it stock
    // we already hold, rather than sitting on the board as loose text.
    /*
     * Both "Patek" and "Patek Philippe" can sit in a brands table, and the
     * shorter one first on purpose: whatever order the rows come back in,
     * the longest name has to win, or half the Pateks file themselves under
     * whichever row happens to sort earlier and the board has two piles of
     * the same brand.
     */
    const known = [
      { id: 'pat', name: 'Patek' },
      { id: 'r', name: 'Rolex' },
      { id: 'pp', name: 'Patek Philippe' },
    ]
    expect(pickBrand('Looking for a Rolex Daytona, white dial', known)).toBe('r')
    expect(pickBrand('Patek Philippe Nautilus 5711, blue dial', known)).toBe('pp')
    expect(pickBrand('A nice watch, around 100k', known)).toBeNull()
  })

  it('asks for one thing and lets the rest go', () => {
    /*
     * A reference and a budget help; neither is worth losing the ask over,
     * because the moment this form is open is the moment somebody is about
     * to close the tab. The words are the only thing insisted on.
     */
    expect(service).toContain("if (!wanted) throw new ValidationError('Say what you are looking for.')")
    expect(cta).toContain('disabled={busy || wanted.trim().length === 0}')
  })

  it('shows them what they have already asked for', () => {
    // An ask that disappears is an ask they make again by email next week.
    expect(cta).toContain('export function AsksSoFar')
    expect(service).toContain('export async function asksFromPartner')
    expect(service).toContain('export async function asksFromAgent')
  })
})
