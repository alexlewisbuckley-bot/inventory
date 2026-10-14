import { can } from '@/lib/permissions'
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
  if (!can(role, 'report:read')) return []
  return [
    { href: '/reports', label: 'Overview' },
    { href: '/reports/people', label: 'Sales by person' },
    { href: '/reports/ageing', label: 'Ageing stock' },
  ]
}
