import { canSeeCost, can } from '@/lib/permissions'
import type { Role } from '@/lib/enums'

/**
 * Money that leaves the server only when the reader may see it.
 *
 * Masking happens here — before data is rendered or serialised — and never in
 * a component. A component that hides a figure with CSS has already shipped
 * it: it is in the HTML, in the RSC payload, in view-source, and the matrix
 * test asserts against the payload precisely because that is the layer that
 * leaks. Cost prices walking out with a departing salesperson is a real and
 * expensive event in this trade, and "hidden" is not the same as "absent".
 *
 * The two grades are deliberate. `cost` is the business's position — purchase
 * price, profit, margin. `revenue` is what things sell for — asking and sale
 * prices, deal values. A salesperson quotes revenue all day and never needs
 * cost; an operations person needs neither.
 */

export function redactRows<T extends object>(
  role: Role,
  rows: T[],
  fields: { cost?: Array<keyof T>; revenue?: Array<keyof T> },
): T[] {
  const dropCost = !canSeeCost(role)
  const dropRevenue = !can(role, 'revenue:read')
  if (!dropCost && !dropRevenue) return rows

  return rows.map((row) => {
    const copy = { ...row }
    if (dropCost) for (const field of fields.cost ?? []) (copy as Record<keyof T, unknown>)[field] = null
    if (dropRevenue) for (const field of fields.revenue ?? []) (copy as Record<keyof T, unknown>)[field] = null
    return copy
  })
}
