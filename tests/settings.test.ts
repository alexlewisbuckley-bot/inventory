import { describe, expect, it } from 'vitest'
import { SETTING_SPECS } from '@/lib/settings-specs'

const validatorFor = (key: string) => SETTING_SPECS.find((s) => s.key === key)!.validate!

describe('settings validation', () => {
  const fx = validatorFor('finance.fxGbpUsd')

  it('rejects an FX rate that would corrupt every USD figure', () => {
    expect(fx('0')).toBeTruthy()
    expect(fx('-1')).toBeTruthy()
    expect(fx('abc')).toBeTruthy()
    expect(fx('100')).toBeTruthy()
  })

  it('accepts a plausible rate', () => {
    expect(fx('1.33')).toBeNull()
    expect(fx('0.75')).toBeNull()
  })

  it('bounds the target margin to a percentage', () => {
    const margin = validatorFor('finance.targetMarginPct')
    expect(margin('-1')).toBeTruthy()
    expect(margin('101')).toBeTruthy()
    expect(margin('8')).toBeNull()
  })

  it('requires whole days for the ageing threshold', () => {
    const ageing = validatorFor('inventory.ageingWarningDays')
    expect(ageing('0')).toBeTruthy()
    expect(ageing('90.5')).toBeTruthy()
    expect(ageing('90')).toBeNull()
  })
})
