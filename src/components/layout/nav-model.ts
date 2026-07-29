import {
  BarChart3, Building2, CheckSquare, Clock, Coins, KanbanSquare, LayoutDashboard,
  LifeBuoy, MapPin, Package, Receipt, Search, Settings, ShieldCheck, Users2,
  type LucideIcon,
} from 'lucide-react'
import { can, type Capability } from '@/lib/permissions'
import type { Role } from '@/lib/enums'

export interface SidebarCounts {
  inStock: number
  unpriced: number
  ageing: number
  sales: number
  openDeals: number
  tasksDue: number
  openRequests: number
}

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  capability?: Capability
  /** Also highlight for nested routes under this path. */
  match?: string
  /** Rendered as a muted count, or an amber pill when it needs attention. */
  count?: number
  attention?: boolean
}

export interface NavGroup {
  heading: string | null
  items: NavItem[]
}

/**
 * The single definition of primary navigation.
 *
 * The sidebar and the mobile drawer render the same structure. Keeping one
 * model means a new destination cannot appear on a desktop and go missing on a
 * phone, which is exactly what happened while the two were written separately.
 */
export function navGroups(role: Role, counts: SidebarCounts): NavGroup[] {
  const groups: NavGroup[] = [
    {
      heading: null,
      items: [
        { href: '/', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/inventory', label: 'Inventory', icon: Package, capability: 'watch:read', match: '/inventory', count: counts.inStock },
        { href: '/sales', label: 'Sales', icon: Receipt, capability: 'sale:read', match: '/sales', count: counts.sales },
      ],
    },
    {
      heading: 'Sell',
      items: [
        { href: '/pipeline', label: 'Pipeline', icon: KanbanSquare, capability: 'deal:read', match: '/pipeline', count: counts.openDeals },
        { href: '/customers', label: 'Customers', icon: Users2, capability: 'customer:read', match: '/customers' },
        { href: '/requests', label: 'Wanted', icon: Search, capability: 'request:read', match: '/requests', count: counts.openRequests },
        { href: '/tasks', label: 'Tasks', icon: CheckSquare, capability: 'task:read', match: '/tasks', count: counts.tasksDue, attention: counts.tasksDue > 0 },
      ],
    },
    {
      heading: 'Needs attention',
      items: [
        { href: '/inventory?unpricedOnly=true', label: 'Unpriced stock', icon: Coins, capability: 'watch:read', count: counts.unpriced, attention: counts.unpriced > 0 },
        { href: '/reports/ageing', label: 'Ageing stock', icon: Clock, capability: 'report:read', count: counts.ageing, attention: counts.ageing > 0 },
      ],
    },
    {
      heading: 'Manage',
      items: [
        { href: '/suppliers', label: 'Suppliers', icon: Building2, capability: 'supplier:read', match: '/suppliers' },
        { href: '/locations', label: 'Locations', icon: MapPin, capability: 'location:read', match: '/locations' },
        { href: '/reports', label: 'Reports', icon: BarChart3, capability: 'report:read', match: '/reports' },
      ],
    },
    {
      heading: 'System',
      items: [
        { href: '/settings', label: 'Settings', icon: Settings, capability: 'settings:read', match: '/settings' },
        { href: '/settings/users', label: 'Users', icon: ShieldCheck, capability: 'user:read' },
        { href: '/help', label: 'Help', icon: LifeBuoy },
      ],
    },
  ]

  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.capability || can(role, item.capability)) }))
    .filter((group) => group.items.length > 0)
}

/**
 * Whether a nav item represents the current page.
 *
 * Two rules, both learned from getting it wrong. Items carrying a query string
 * (the saved-view shortcuts) never match on prefix, or "Unpriced stock" would
 * light up for the whole inventory section. And the most specific item wins:
 * `/settings/users` is matched by both "Settings" and "Users", which lit two
 * rows of the sidebar at once and left the user unsure which section they were
 * actually in.
 */
export function isActive(item: NavItem, pathname: string, all?: NavItem[]): boolean {
  const matches = (candidate: NavItem): boolean => {
    if (candidate.href.includes('?')) return false
    if (candidate.match) return pathname.startsWith(candidate.match)
    return pathname === candidate.href
  }

  if (!matches(item)) return false
  if (!all) return true

  // Yield to any other item that also matches and is more specific.
  const specificity = (candidate: NavItem) => (candidate.match ?? candidate.href).length
  return !all.some((other) => other !== item && matches(other) && specificity(other) > specificity(item))
}

/** Every item across every group, for specificity comparisons. */
export function flattenNav(groups: NavGroup[]): NavItem[] {
  return groups.flatMap((group) => group.items)
}
