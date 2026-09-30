'use client'
import { useCurrency } from '@/components/ui'
import { setPriceAction } from '@/app/actions/watches'
import { parseMoneyInput } from '@/lib/money'
import { InlineEditCell } from './InlineEditCell'

/**
 * Editable retail price.
 *
 * Setting a price was the single most repeated task in the product and cost
 * six interactions: find the row, open the drawer, click edit, wait for a
 * form, change one number, save. It is now click, type, Enter — in the cell
 * the reader is already looking at.
 *
 * It behaves exactly as cost, trade, year and serial do, because it is the
 * same gesture on the same kind of thing and there is no reason for the price
 * column to have manners of its own. What it keeps to itself is who may use
 * it: `watch:price` rather than the owner-only `watch:amend`, because quoting
 * is a salesperson's job.
 *
 * The value is entered in whatever currency is on display and converted to
 * the base on save, so someone working in AED never converts by hand.
 */
export function InlinePriceCell({ watchId, baseMinor, editable }: {
  watchId: string
  baseMinor: number | null
  editable: boolean
}) {
  const { money, currency, convert } = useCurrency()

  return (
    <InlineEditCell
      label="retail price"
      kind="money"
      align="right"
      editable={editable}
      value={baseMinor === null ? '' : String(convert(baseMinor) / 100)}
      display={baseMinor === null ? <span className="text-content-muted">—</span> : money(baseMinor)}
      placeholder="Set price"
      onSave={async (raw) => {
        const entered = parseMoneyInput(raw)
        if (entered === null) return 'Enter an amount.'
        const result = await setPriceAction(watchId, entered / 100, currency)
        return result.ok ? null : (result.message ?? 'The change was rejected.')
      }}
    />
  )
}
