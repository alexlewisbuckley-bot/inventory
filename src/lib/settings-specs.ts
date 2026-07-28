/**
 * Declarative registry of application settings.
 *
 * Kept free of database imports so the validators are unit-testable and can be
 * reused by the client for instant feedback. Each key declares its own
 * validator because a bad value here is silently destructive — an FX rate of
 * zero would corrupt every USD figure the system derives.
 */
export interface SettingSpec {
  key: string
  label: string
  description: string
  group: 'Company' | 'Finance' | 'Inventory'
  type: 'text' | 'number' | 'currency'
  validate?: (value: string) => string | null
}

export const SETTING_SPECS: SettingSpec[] = [
  { key: 'company.name', label: 'Company name', group: 'Company', type: 'text',
    description: 'Shown on exports and printed records.' },
  { key: 'company.tradingName', label: 'System name', group: 'Company', type: 'text',
    description: 'The name shown in the application header.' },
  {
    key: 'finance.fxGbpUsd', label: 'GBP → USD rate', group: 'Finance', type: 'number',
    description: 'Applied when converting new purchases and sales. Historic records keep the rate captured at the time.',
    validate: (value) => {
      const rate = Number(value)
      if (!Number.isFinite(rate) || rate <= 0) return 'Enter a rate greater than zero.'
      if (rate > 10) return 'That rate looks wrong — please check.'
      return null
    },
  },
  {
    key: 'finance.targetMarginPct', label: 'Target margin (%)', group: 'Finance', type: 'number',
    description: 'Used to flag stock priced below your expected return.',
    validate: (value) => {
      const pct = Number(value)
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return 'Enter a percentage between 0 and 100.'
      return null
    },
  },
  {
    key: 'inventory.ageingWarningDays', label: 'Ageing warning (days)', group: 'Inventory', type: 'number',
    description: 'Stock held longer than this appears in the ageing report.',
    validate: (value) => {
      const days = Number(value)
      if (!Number.isInteger(days) || days < 1 || days > 3650) return 'Enter a whole number of days between 1 and 3650.'
      return null
    },
  },
]
