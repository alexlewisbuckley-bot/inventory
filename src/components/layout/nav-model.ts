import {
  BarChart3, Building2, Clock, Coins, LayoutDashboard,
  MapPin, Package, Receipt, Settings, ShieldCheck, type LucideIcon,
} from 'lucide-react'
import { can, type Capability } from '@/lib/permissions'
import type { Role } from '@/lib/enums'

export interface SidebarCounts {
  inStock: number
  unpriced: number
  ageing: number
  sales: number
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
 * Items carrying a query string (the saved-view shortcuts) never match on
 * prefix, or "Unpriced stock" would light up for the whole inventory section.
 */
export function isActive(item: NavItem, pathname: string): boolean {
  if (item.match) return pathname.startsWith(item.match) && !item.href.includes('?')
  return pathname === item.href
}
