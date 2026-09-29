import { describe, expect, it } from 'vitest'
import { SETTING_SPECS } from '@/lib/settings-specs'

const validatorFor = (key: string) => SETTING_SPECS.find((s) => s.key === key)!.validate!

describe('settings validation', () => {
  /**
   * Exchange rates are managed in Settings → Currencies, against the base.
   * A second rate field here was inert once the base moved to dollars — it
   * read as the knob that converts purchases while converting nothing, which
   * is worse than not offering it at all.
   */
  it('offers no second place to set an exchange rate', () => {
    expect(SETTING_SPECS.find((s) => s.key === 'finance.fxGbpUsd')).toBeUndefined()
    expect(SETTING_SPECS.filter((s) => /rate/i.test(s.label))).toEqual([])
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
