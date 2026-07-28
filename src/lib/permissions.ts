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
] as const

export type Capability = (typeof CAPABILITIES)[number]

const VIEWER: Capability[] = [
  'watch:read', 'sale:read', 'supplier:read', 'location:read', 'report:read',
]

const STAFF: Capability[] = [
  ...VIEWER,
  'watch:create', 'watch:update', 'watch:move', 'watch:price',
  'sale:create', 'report:export',
]

const MANAGER: Capability[] = [
  ...STAFF,
  'watch:delete', 'watch:restore',
  'sale:update', 'sale:delete',
  'supplier:manage', 'location:manage',
  'data:import', 'user:read', 'settings:read', 'audit:read',
]

const OWNER: Capability[] = [...MANAGER, 'user:manage', 'settings:manage']

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  VIEWER: VIEWER,
  STAFF: STAFF,
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
  if (actorRole === 'OWNER') return ['OWNER', 'MANAGER', 'STAFF', 'VIEWER']
  if (actorRole === 'MANAGER') return ['STAFF', 'VIEWER']
  return []
}
