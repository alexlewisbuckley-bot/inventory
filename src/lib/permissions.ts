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
  'data:import',
  'user:read', 'user:manage',
  'settings:read', 'settings:manage',
  'audit:read',
  // CRM. Reading the customer book is part of every selling role, but the
  // commercial detail on a deal and the ability to delete a relationship are
  // not: a viewer is usually someone shown the stock, not the client list.
  'customer:read', 'customer:create', 'customer:update', 'customer:delete',
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
  'revenue:read', 'cost:read',
]

/**
 * Sells, without seeing the cost side.
 *
 * Everything a Staff member does with customers, deals and tasks — but no
 * cost, profit or margin anywhere: not on the inventory list, not on a sold
 * row, not in a report. The capability is enforced at the read boundary, so
 * the figures are absent from what the server sends, not hidden by CSS.
 */
const SALES: Capability[] = [
  'watch:read', 'sale:read', 'sale:create', 'supplier:read', 'location:read', 'owner:read',
  'revenue:read',
  'watch:price',
  'customer:read', 'customer:create', 'customer:update',
  'deal:read', 'deal:create', 'deal:update',
  'activity:read', 'activity:create',
  'task:read', 'task:create', 'task:update',
  'request:read', 'request:create', 'request:update',
  // Their own month, and nobody else's. Not `report:read`: that is the
  // capital position and the supplier spend, which is not what somebody
  // asking how they are doing wants to know.
  'report:own',
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
