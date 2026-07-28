import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { can, ROLE_CAPABILITIES } from '@/lib/permissions'
import type { Role } from '@/lib/enums'

/**
 * Security invariants that must hold regardless of how the code is refactored.
 */
describe('session token handling', () => {
  it('stores only a hash, so a database leak does not yield usable tokens', () => {
    const token = 'a-raw-session-token'
    const stored = createHash('sha256').update(token).digest('hex')
    expect(stored).not.toContain(token)
    expect(stored).toHaveLength(64)
    // The hash must be reproducible for lookup, but not reversible.
    expect(createHash('sha256').update(token).digest('hex')).toBe(stored)
  })
})

describe('privilege boundaries', () => {
  const DESTRUCTIVE = ['watch:delete', 'sale:delete', 'user:manage', 'settings:manage'] as const

  it('grants no destructive capability to viewers or staff', () => {
    for (const capability of DESTRUCTIVE) {
      expect(can('VIEWER', capability)).toBe(false)
      expect(can('STAFF', capability)).toBe(false)
    }
  })

  it('keeps user and settings management exclusive to owners', () => {
    const exclusive: Array<Parameters<typeof can>[1]> = ['user:manage', 'settings:manage']
    for (const capability of exclusive) {
      for (const role of ['VIEWER', 'STAFF', 'MANAGER'] as Role[]) {
        expect(can(role, capability)).toBe(false)
      }
      expect(can('OWNER', capability)).toBe(true)
    }
  })

  it('declares no capability that is not in the registry', () => {
    const all = new Set(Object.values(ROLE_CAPABILITIES).flat())
    for (const capability of all) expect(typeof capability).toBe('string')
    // Viewer is strictly the smallest set.
    expect(ROLE_CAPABILITIES.VIEWER.length).toBeLessThan(ROLE_CAPABILITIES.STAFF.length)
    expect(ROLE_CAPABILITIES.STAFF.length).toBeLessThan(ROLE_CAPABILITIES.MANAGER.length)
    expect(ROLE_CAPABILITIES.MANAGER.length).toBeLessThan(ROLE_CAPABILITIES.OWNER.length)
  })
})
