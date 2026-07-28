import { describe, expect, it } from 'vitest'
import { diff } from '@/lib/diff'

describe('audit diffing', () => {
  const before = { model: '126711CHNR', estSaleUsd: 1865000, notes: null, status: 'IN_STOCK' }

  it('records only fields that actually changed', () => {
    const changes = diff(before, { model: '126711CHNR', estSaleUsd: 1890000 }, ['model', 'estSaleUsd'])
    expect(changes).toEqual({ estSaleUsd: { from: 1865000, to: 1890000 } })
  })

  it('returns undefined when nothing changed, so no-op saves write no audit noise', () => {
    expect(diff(before, { model: '126711CHNR' }, ['model'])).toBeUndefined()
  })

  it('ignores fields absent from the patch rather than treating them as cleared', () => {
    const changes = diff(before, { status: 'SOLD' }, ['status', 'notes'])
    expect(changes).toEqual({ status: { from: 'IN_STOCK', to: 'SOLD' } })
  })

  it('compares dates by value, not identity', () => {
    const a = { when: new Date('2026-04-08') }
    expect(diff(a, { when: new Date('2026-04-08') }, ['when'])).toBeUndefined()
    expect(diff(a, { when: new Date('2026-04-09') }, ['when'])).toBeDefined()
  })
})
