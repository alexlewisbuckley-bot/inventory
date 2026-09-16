import { getRateTable } from './fx-service'
import { getPreferencesFor } from './settings-service'
import { isCurrency, type DisplayMoney } from '@/lib/currency'
import { DEFAULT_DISPLAY_CURRENCY } from '@/lib/enums'

/**
 * What one person's figures should be shown in.
 *
 * The pages each resolve this inline, because they are already loading rates
 * and preferences for other reasons and an extra helper would only hide two
 * lines. The API routes are not: search and peek return formatted strings and
 * had no reason to know about currency at all until the screens stopped
 * defaulting to the currency everything is stored in.
 *
 * Two small reads — a four-row table and one indexed row — on a path with a
 * 100ms budget. Deliberate: a palette quoting sterling for the watch whose own
 * page says dollars is not a saving, it is two answers to one question. The
 * budget is asserted by a journey rather than estimated here.
 */
export async function displayMoneyFor(userId: string): Promise<DisplayMoney> {
  const [rates, preferences] = await Promise.all([getRateTable(), getPreferencesFor(userId)])
  return {
    rates,
    currency: isCurrency(preferences?.displayCurrency)
      ? preferences.displayCurrency
      : DEFAULT_DISPLAY_CURRENCY,
  }
}
