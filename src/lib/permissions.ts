import type { Role } from './enums'

/**
 * Capability-based access control.
 *
 * Roles map to a set of capabilities rather than being checked directly, so a
 * new role is a data change here and nothing else in the codebase moves. Every
 * server action and API route asserts a capability via `requireCapability`.
 */
export const CAPABILITIES = [
  'watch:read', 'watch:create', 'watch:update', 'watch:delete', 'watch:restore',
  'watch:move', 'watch:price',
  /**
   * Correcting a booked-in figure from the list itself — cost, trade, year,
   * serial — without opening the record.
   *
   * Held apart from `watch:update`, which is the whole record behind a form
   * with a save button. This is a value changed in a cell in one gesture, on
   * the numbers the business is valued on, and it is the owner's alone. The
   * retail price is deliberately not in here: `watch:price` already covers
   * it, and quoting is a salesperson's job.
   */
  'watch:amend',
  'sale:read', 'sale:create', 'sale:update', 'sale:delete',
  'supplier:read', 'supplier:manage',
  'location:read', 'location:manage',
  'owner:read', 'owner:manage',
  'reseller:read', 'reseller:manage',
  /**
   * The trade catalogue: our stock at trade and retail prices, and nothing
   * else. Held apart from `watch:read` on purpose — the inventory list is
   * built around supplier, serial, location and cost, so a role that may see
   * stock but none of that needs its own door rather than a redacted version
   * of somebody else's.
   */
  'catalogue:read',
  'report:read', 'report:export',
  /**
   * What the business costs to run, and the net profit that follows from it.
   *
   * Reading is `report:read` like any other figure. Changing one is the
   * owner's alone and has its own capability, because the rent and the
   * payroll are the numbers a net profit is built on: everybody who may see
   * a P&L should not thereby be able to rewrite its cost base.
   */
  'overhead:manage',
  /**
   * Your own sales figures, and nobody else's.
   *
   * Held apart from `report:read`, which is the whole business. A
   * salesperson asking how their month is going is not asking to see the
   * capital position, the supplier spend or what anybody else sold, and the
   * answer to the narrow question should not require the wide capability.
   *
   * It carries a deliberate, narrow exception to the cost firewall: profit
   * and margin on the watches this person sold, which cannot be given
   * without implying what those watches cost. That is a smaller leak than
   * `cost:read` — it is their own handful of sales rather than the whole
   * book — and it is the price of a salesperson being able to see whether
   * they are selling well or merely often.
   */
  'report:own',
  /**
   * Putting a watch out to a dealer group, picture and price together.
   *
   * The owner's alone, and deliberately not implied by `watch:read` or
   * `watch:price`. Everybody selling can see the trade figure; posting it
   * into a WhatsApp group is a different act, because the message leaves the
   * building, carries the trade price in it and can be forwarded on by
   * anybody who receives it. Who broadcasts the book is a decision about the
   * business, not about a screen.
   */
  'watch:broadcast',
  /**
   * Lending against watches, and the money it earns.
   *
   * Its own pair rather than folded into sales, because a buy-back puts the
   * firm's cash out of the door against somebody else's property. Reading
   * one shows what a customer owes and what is being held for them;
   * writing one commits capital and, on a default, takes the watches. Both
   * are decisions about the business rather than about a screen.
   */
  'buyback:read', 'buyback:write',
  'data:import',
  'user:read', 'user:manage',
  'settings:read', 'settings:manage',
  'audit:read',
  // CRM. Reading the customer book is part of every selling role, but the
  // commercial detail on a deal and the ability to delete a relationship are
  // not: a viewer is usually someone shown the stock, not the client list.
  'customer:read', 'customer:create', 'customer:update', 'customer:delete',
  /**
   * The customers you own, and nobody else's.
   *
   * Held apart from `customer:read`, which is the whole book. A salesperson
   * looking up the client in front of them is not asking to read the firm's
   * entire contact list, and in this trade a contact list is the asset most
   * worth walking out of the door with. Enforced in the query by owner id
   * rather than by a filter on the screen — a filter is a default, and a
   * default is removed by editing the address bar.
   */
  'customer:own',
  'deal:read', 'deal:create', 'deal:update', 'deal:delete',
  'activity:read', 'activity:create',
  'task:read', 'task:create', 'task:update',
  'request:read', 'request:create', 'request:update',
  /**
   * What money a person may see, separate from what they may do.
   *
   * `cost:read` covers purchase price, profit and margin — the figures that
   * reveal the business's position rather than its prices. A salesperson can
   * quote an asking price all day without ever needing to know what the watch
   * cost, and in the trade, cost prices leaking through a departing
   * salesperson is a real and expensive event. `revenue:read` covers sale
   * amounts and pipeline values.
   */
  'cost:read', 'revenue:read',
  /**
   * The trade's own door, and the one person who answers it.
   *
   * `trade:enquire` is a dealer on the catalogue saying they want something.
   * `trade:respond` is replying, approving or declining — the owner's alone,
   * because approving turns an enquiry into a deal on the board and a board
   * anybody can write to is a board nobody reads.
   */
  'trade:enquire', 'trade:respond',
] as const

export type Capability = (typeof CAPABILITIES)[number]

const VIEWER: Capability[] = [
  'watch:read', 'sale:read', 'supplier:read', 'location:read', 'owner:read', 'report:read',
  // Redundant beside `report:read`, which is strictly wider, and held anyway
  // so that the roles above this one are supersets of the ones beside them.
  // The matrix test asserts that nobody holds a capability the Owner does
  // not, and it is right to: a narrow capability invented for one role and
  // never given to the roles above it is how somebody senior ends up unable
  // to do something their junior can.
  'report:own',
  // Same reason as `report:own` above: redundant beside `customer:read`,
  // which is strictly wider, and held so the roles above remain supersets.
  'customer:own',
  'revenue:read', 'cost:read',
]

/**
 * Looks everything up, changes nothing.
 *
 * A reference seat rather than a working one. The job is to stand in front
 * of a client and answer "what have we got, and what can it go for" — so the
 * whole stock list is open, with search, filters and all three prices on it,
 * cost included.
 *
 * It holds no write at all. Not a sale, not a price, not a customer, not a
 * task. That is deliberate and it is the easier half to get right: a role
 * that cannot write cannot be talked into writing by a screen that forgot to
 * check, and every button that would have done so is already gated on the
 * capability it no longer has.
 *
 * `cost:read` is here at the owner's instruction, and it reverses the rule
 * this role was originally built around — that cost prices should not leave
 * with a departing salesperson. The figure now reaches anybody holding this
 * role, so who holds it is the control, and removing somebody's account is
 * the only thing that takes it back.
 *
 * Still not `report:read`: the capital position, the supplier spend and the
 * profit and loss are the business's own account of itself, and reading a
 * price list is not a reason to be shown them.
 *
 * Nor `owner:read`, which was the same rule leaking through a side door. The
 * Owners page is a list of who the firm's backers are and how much capital
 * each has in the book — "Edward Jackson, 133 watches, AED 19,922,890, 81% of
 * capital across all owners" — which is the capital position stated per
 * person. A salesperson looking up what a watch costs has no call to be shown
 * it, and the page was the only thing the capability opened.
 */
const SALES: Capability[] = [
  'watch:read', 'location:read',
  // All three prices: what it cost, what the trade pays, what it is asking.
  'revenue:read', 'cost:read',
  // Their own clients and their own figures. Not the firm's contact list,
  // not the pipeline, not the sales ledger.
  'customer:own', 'report:own',
]

/**
 * Moves stock, without the commercial layer.
 *
 * Intake, locations, movements, despatch. No customer book, no pipeline, and
 * no money in either direction — an operations person books a watch in and
 * moves it to the vault without ever being shown what it cost or what it is
 * asking.
 */
const OPERATIONS: Capability[] = [
  'watch:read', 'watch:create', 'watch:update', 'watch:move',
  'supplier:read', 'location:read', 'location:manage', 'owner:read',
  'task:read', 'task:create', 'task:update',
]

const STAFF: Capability[] = [
  ...VIEWER,
  'watch:create', 'watch:update', 'watch:move', 'watch:price',
  'sale:create', 'report:export',
  // Selling is the job: a salesperson owns their customers, their pipeline and
  // their follow-ups outright.
  'customer:read', 'customer:create', 'customer:update',
  'deal:read', 'deal:create', 'deal:update',
  'activity:read', 'activity:create',
  'task:read', 'task:create', 'task:update',
  'request:read', 'request:create', 'request:update',
]

const MANAGER: Capability[] = [
  ...STAFF,
  'buyback:read',
  'watch:delete', 'watch:restore',
  'sale:update', 'sale:delete',
  'supplier:manage', 'location:manage', 'owner:manage',
  'reseller:read', 'reseller:manage',
  'data:import', 'user:read', 'settings:read', 'audit:read',
  'customer:delete', 'deal:delete',
]

const OWNER: Capability[] = [
  ...MANAGER, 'user:manage', 'settings:manage', 'watch:amend', 'trade:respond', 'overhead:manage',
  'watch:broadcast',
  'buyback:write',
]

/**
 * A dealer we sell to. One capability, and it is a read.
 *
 * Deliberately not `watch:read`: that opens the inventory list, which is a
 * working screen built around supplier, serial, location, cost and margin —
 * every one of which is ours and none of which is theirs. The catalogue is a
 * separate route over a separate query that names only the columns a trade
 * partner is entitled to, so there is no redaction to get wrong and no
 * mutation to forbid, because the page offers none.
 */
const TRADER: Capability[] = ['catalogue:read', 'trade:enquire']

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  VIEWER: VIEWER,
  STAFF: STAFF,
  SALES: SALES,
  OPERATIONS: OPERATIONS,
  MANAGER: MANAGER,
  OWNER: OWNER,
  TRADER: TRADER,
}

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false
  return ROLE_CAPABILITIES[role].includes(capability)
}

export function canAny(role: Role | null | undefined, capabilities: Capability[]): boolean {
  return capabilities.some((c) => can(role, c))
}

export function canAll(role: Role | null | undefined, capabilities: Capability[]): boolean {
  return capabilities.every((c) => can(role, c))
}

/** Roles a given actor is allowed to assign. Nobody may create an Owner but an Owner. */
export function assignableRoles(actorRole: Role): Role[] {
  if (actorRole === 'OWNER') return ['OWNER', 'MANAGER', 'STAFF', 'SALES', 'OPERATIONS', 'VIEWER', 'TRADER']
  if (actorRole === 'MANAGER') return ['STAFF', 'SALES', 'OPERATIONS', 'VIEWER', 'TRADER']
  return []
}

/**
 * Whether this role sees the whole book of sales or only their own.
 *
 * A named helper rather than two inlined `can(...)` calls, because getting it
 * backwards — checking the narrow capability first and letting an owner fall
 * into the scoped view — is a silent failure that looks like working
 * software.
 */
export function salesScope(role: Role | null | undefined): 'all' | 'own' | 'none' {
  if (can(role, 'report:read')) return 'all'
  if (can(role, 'report:own')) return 'own'
  return 'none'
}

/**
 * May this role see what things cost — purchase price, profit, margin?
 *
 * A named helper rather than an inlined `can(...)` because the question is
 * asked at every read boundary that returns money, and a grep for
 * `canSeeCost` is how the next person audits that every one of them asks it.
 */
/**
 * How much of the customer book this role may read.
 *
 * Mirrors `salesScope`. 'own' is narrowed in the query by owner id, which is
 * the only place it can be done safely: the list already takes an `ownerId`
 * filter from the address bar, and a filter somebody can delete is not an
 * access control.
 */
export function customerScope(role: Role | null | undefined): 'all' | 'own' | 'none' {
  if (can(role, 'customer:read')) return 'all'
  if (can(role, 'customer:own')) return 'own'
  return 'none'
}

export function canSeeCost(role: Role | null | undefined): boolean {
  return can(role, 'cost:read')
}

/**
 * Whether this role is an outside party rather than a member of staff.
 *
 * Asked where the answer is "show them their own front door and nothing
 * else" — the landing redirect and the navigation rail — rather than at a
 * read boundary, which asks for a capability like everything else.
 */
export function isExternalRole(role: Role | null | undefined): boolean {
  return role === 'TRADER'
}

/** The page a role belongs on when it lands somewhere it should not be. */
export function landingFor(role: Role | null | undefined): string {
  return isExternalRole(role) ? '/catalogue' : '/today'
}
