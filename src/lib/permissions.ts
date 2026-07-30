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
  'sale:read', 'sale:create', 'sale:update', 'sale:delete',
  'supplier:read', 'supplier:manage',
  'location:read', 'location:manage',
  'report:read', 'report:export',
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
] as const

export type Capability = (typeof CAPABILITIES)[number]

const VIEWER: Capability[] = [
  'watch:read', 'sale:read', 'supplier:read', 'location:read', 'report:read',
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
  'watch:read', 'sale:read', 'sale:create', 'supplier:read', 'location:read',
  'revenue:read',
  'watch:price',
  'customer:read', 'customer:create', 'customer:update',
  'deal:read', 'deal:create', 'deal:update',
  'activity:read', 'activity:create',
  'task:read', 'task:create', 'task:update',
  'request:read', 'request:create', 'request:update',
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
  'supplier:read', 'location:read', 'location:manage',
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
  'supplier:manage', 'location:manage',
  'data:import', 'user:read', 'settings:read', 'audit:read',
  'customer:delete', 'deal:delete',
]

const OWNER: Capability[] = [...MANAGER, 'user:manage', 'settings:manage']

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  VIEWER: VIEWER,
  STAFF: STAFF,
  SALES: SALES,
  OPERATIONS: OPERATIONS,
  MANAGER: MANAGER,
  OWNER: OWNER,
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
  if (actorRole === 'OWNER') return ['OWNER', 'MANAGER', 'STAFF', 'SALES', 'OPERATIONS', 'VIEWER']
  if (actorRole === 'MANAGER') return ['STAFF', 'SALES', 'OPERATIONS', 'VIEWER']
  return []
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
