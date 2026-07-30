import { describe, expect, it } from 'vitest'
import { ROLES, type Role } from '@/lib/enums'
import {
  assignableRoles, can, canSeeCost, CAPABILITIES, ROLE_CAPABILITIES,
} from '@/lib/permissions'

/**
 * The permission matrix, asserted rather than assumed.
 *
 * Every rule here is a sentence somebody could be fired over getting wrong:
 * who sees cost prices, who can reach the customer book, who can grant what.
 * The matrix is small enough to state exhaustively, so it is stated
 * exhaustively — a spot-check of the interesting cells is how the
 * uninteresting cell turns out to be the leak.
 */

describe('the role matrix', () => {
  it('declares a capability set for every role, using only declared capabilities', () => {
    for (const role of ROLES) {
      const set = ROLE_CAPABILITIES[role]
      expect(set, role).toBeTruthy()
      for (const capability of set) expect(CAPABILITIES).toContain(capability)
      // No duplicates: a capability listed twice is usually a merge mistake.
      expect(new Set(set).size).toBe(set.length)
    }
  })

  it('gives nobody more than the Owner', () => {
    const owner = new Set(ROLE_CAPABILITIES.OWNER)
    for (const role of ROLES) {
      for (const capability of ROLE_CAPABILITIES[role]) {
        expect(owner.has(capability), `${role} has ${capability} but OWNER does not`).toBe(true)
      }
    }
  })

  it('keeps cost prices away from Sales, everywhere cost exists', () => {
    // The rule the role exists for. A salesperson quotes asking prices all
    // day and never needs to know what the watch cost; in this trade, cost
    // prices leaving with a departing salesperson is a real and expensive
    // event.
    expect(canSeeCost('SALES')).toBe(false)
    expect(can('SALES', 'revenue:read')).toBe(true)
    // But selling still works end to end.
    for (const needed of ['customer:read', 'deal:create', 'sale:create', 'task:create', 'watch:price'] as const) {
      expect(can('SALES', needed), `SALES lacks ${needed}`).toBe(true)
    }
    // And the surfaces made entirely of cost figures are simply not theirs.
    expect(can('SALES', 'report:read')).toBe(false)
    expect(can('SALES', 'report:export')).toBe(false)
    expect(can('SALES', 'data:import')).toBe(false)
  })

  it('keeps all money and the whole customer book away from Operations', () => {
    expect(canSeeCost('OPERATIONS')).toBe(false)
    expect(can('OPERATIONS', 'revenue:read')).toBe(false)
    for (const commercial of ['customer:read', 'deal:read', 'sale:read', 'report:read'] as const) {
      expect(can('OPERATIONS', commercial), `OPERATIONS has ${commercial}`).toBe(false)
    }
    // But the job is fully possible: intake, movement, locations, tasks.
    for (const needed of ['watch:read', 'watch:create', 'watch:move', 'location:manage', 'task:create'] as const) {
      expect(can('OPERATIONS', needed), `OPERATIONS lacks ${needed}`).toBe(true)
    }
    // Operations books watches in without pricing them — pricing is a
    // commercial act.
    expect(can('OPERATIONS', 'watch:price')).toBe(false)
  })

  it('keeps the Viewer read-only but fully sighted', () => {
    // The seed's viewer is Finance. Reports without cost are not reports, so
    // the viewer sees everything and changes nothing.
    expect(canSeeCost('VIEWER')).toBe(true)
    const writes = CAPABILITIES.filter((capability) =>
      /:(create|update|delete|manage|move|price|restore)$/.test(capability) || capability === 'data:import')
    for (const write of writes) {
      expect(can('VIEWER', write), `VIEWER can ${write}`).toBe(false)
    }
  })

  it('never lets a role grant a role it could not have granted before', () => {
    expect(assignableRoles('OWNER')).toContain('SALES')
    expect(assignableRoles('OWNER')).toContain('OPERATIONS')
    expect(assignableRoles('MANAGER')).not.toContain('OWNER')
    expect(assignableRoles('MANAGER')).not.toContain('MANAGER')
    expect(assignableRoles('STAFF' as Role)).toEqual([])
    expect(assignableRoles('SALES' as Role)).toEqual([])
    expect(assignableRoles('OPERATIONS' as Role)).toEqual([])
  })

  it('holds the sensitive-field matrix, exhaustively', () => {
    // role × field-grade. True means the figure may leave the server for
    // this role. Every cell written out — the uninteresting cell is where
    // the leak lives.
    const expected: Record<Role, { cost: boolean; revenue: boolean }> = {
      OWNER: { cost: true, revenue: true },
      MANAGER: { cost: true, revenue: true },
      STAFF: { cost: true, revenue: true },
      VIEWER: { cost: true, revenue: true },
      SALES: { cost: false, revenue: true },
      OPERATIONS: { cost: false, revenue: false },
    }
    for (const role of ROLES) {
      expect(canSeeCost(role), `${role} cost`).toBe(expected[role].cost)
      expect(can(role, 'revenue:read'), `${role} revenue`).toBe(expected[role].revenue)
    }
  })
})
