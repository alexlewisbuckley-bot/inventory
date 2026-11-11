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
  group: 'Company' | 'Finance' | 'Inventory' | 'AI'
  type: 'text' | 'number' | 'currency'
  validate?: (value: string) => string | null
}

export const SETTING_SPECS: SettingSpec[] = [
  { key: 'company.name', label: 'Company name', group: 'Company', type: 'text',
    description: 'Shown on exports and printed records.' },
  { key: 'company.tradingName', label: 'System name', group: 'Company', type: 'text',
    description: 'The name shown in the application header.' },
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
    key: 'ai.monthlyBudgetUsd', label: 'Monthly AI budget (USD)', group: 'AI', type: 'number',
    description:
      'A ceiling on what reading invoices and photographs may cost in a month. '
      + 'Reached, those features stop and say so rather than spending more. Leave blank for no ceiling.',
    validate: (value) => {
      // Blank is a real answer: no ceiling, which is how this behaved before
      // the setting existed and must stay the default.
      if (value.trim() === '') return null
      const usd = Number(value)
      if (!Number.isFinite(usd) || usd < 0) return 'Enter an amount in dollars, or leave it blank for no ceiling.'
      if (usd > 10_000) return 'That is higher than any plausible month. Enter a smaller amount.'
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
