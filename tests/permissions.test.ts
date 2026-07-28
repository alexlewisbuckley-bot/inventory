import { describe, expect, it } from 'vitest'
import { can, canAll, assignableRoles, ROLE_CAPABILITIES } from '@/lib/permissions'

describe('permissions', () => {
  it('gives viewers read access but no writes', () => {
    expect(can('VIEWER', 'watch:read')).toBe(true)
    expect(can('VIEWER', 'watch:create')).toBe(false)
    expect(can('VIEWER', 'watch:delete')).toBe(false)
  })

  it('lets staff run the day-to-day workflow but not destroy data', () => {
    expect(canAll('STAFF', ['watch:create', 'watch:update', 'watch:move', 'sale:create'])).toBe(true)
    expect(can('STAFF', 'watch:delete')).toBe(false)
    expect(can('STAFF', 'user:manage')).toBe(false)
  })

  it('reserves user and settings management for owners', () => {
    expect(can('MANAGER', 'user:manage')).toBe(false)
    expect(can('MANAGER', 'settings:manage')).toBe(false)
    expect(can('OWNER', 'user:manage')).toBe(true)
    expect(can('OWNER', 'settings:manage')).toBe(true)
  })

  it('escalates capabilities monotonically up the role ladder', () => {
    for (const capability of ROLE_CAPABILITIES.VIEWER) expect(can('STAFF', capability)).toBe(true)
    for (const capability of ROLE_CAPABILITIES.STAFF) expect(can('MANAGER', capability)).toBe(true)
    for (const capability of ROLE_CAPABILITIES.MANAGER) expect(can('OWNER', capability)).toBe(true)
  })

  it('never lets a non-owner mint an owner', () => {
    expect(assignableRoles('OWNER')).toContain('OWNER')
    expect(assignableRoles('MANAGER')).not.toContain('OWNER')
    expect(assignableRoles('STAFF')).toEqual([])
  })

  it('denies everything for an absent role', () => {
    expect(can(null, 'watch:read')).toBe(false)
    expect(can(undefined, 'watch:read')).toBe(false)
  })
})
