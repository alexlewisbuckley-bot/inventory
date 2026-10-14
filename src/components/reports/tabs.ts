import { salesScope } from '@/lib/permissions'
import type { Role } from '@/lib/enums'
import type { ReportTab } from './ReportTabs'

/**
 * Which report views this reader may open.
 *
 * Decided here, once, from capabilities — so the tab row, the links between
 * pages and the guards on the pages themselves cannot drift into disagreeing
 * about what exists. A tab is a door; drawing one somebody cannot open is a
 * worse answer than not drawing it.
 */
export function reportTabs(role: Role | null | undefined): ReportTab[] {
  const scope = salesScope(role)
  if (scope === 'none') return []
  // Somebody who may see only their own month gets one view, named for what
  // it is. The row hides itself at one tab, so they see a page rather than a
  // navigation implying three they cannot open.
  if (scope === 'own') return [{ href: '/reports/people', label: 'My sales' }]
  return [
    { href: '/reports', label: 'Overview' },
    { href: '/reports/people', label: 'Sales by person' },
    { href: '/reports/ageing', label: 'Ageing stock' },
    { href: '/reports/commission', label: 'Commission' },
  ]
}
