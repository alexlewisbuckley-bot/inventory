import {
  Table2,
  BarChart3, Building2, CheckSquare, ClipboardCheck, Clock, Coins, KanbanSquare,
  Landmark, LayoutDashboard, MapPin, MessageSquare, Package, Receipt, Search, Store, Users2,
  type LucideIcon,
  HandCoins,
} from 'lucide-react'
import { can, canAny, isExternalRole, salesScope, type Capability } from '@/lib/permissions'
import type { Role } from '@/lib/enums'

export interface SidebarCounts {
  inStock: number
  unpriced: number
  ageing: number
  sales: number
  openDeals: number
  tasksDue: number
  openRequests: number
  /** Trade enquiries with something nobody here has read. */
  tradeEnquiries: number
}

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  capability?: Capability
  /**
   * Several capabilities, any one of which opens the item.
   *
   * For a page with two legitimate doors: the customer book reads whole for
   * a manager and scoped to their own for a salesperson, and both arrive at
   * the same screen. Without this the narrow role reached the page by typing
   * the address and found no link to it.
   */
  anyOf?: Capability[]
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
        // "Today" rather than "Dashboard", and it is the first thing in the
        // rail because it is the first thing anybody needs: what should I do
        // now. The figures moved to Insights, under Manage, where they are
        // looked at deliberately.
        { href: '/today', label: 'Today', icon: LayoutDashboard, match: '/today' },
        // The trade partner's whole application. It sits first because for
        // that role it is also the only thing in the rail.
        //
        // Labelled "Inventory", same as the staff screen below it, because to
        // the reader it is the stock — the two never appear in one person's
        // rail, so the shared label cannot be ambiguous to anybody. The route
        // stays /catalogue to keep them apart in the code, where the
        // distinction is the whole point.
        { href: '/catalogue', label: 'Inventory', icon: Package, capability: 'catalogue:read', match: '/catalogue' },
        { href: '/inventory', label: 'Inventory', icon: Package, capability: 'watch:read', match: '/inventory', count: counts.inStock },
        { href: '/sales', label: 'Sales', icon: Receipt, capability: 'sale:read', match: '/sales', count: counts.sales },
        // Beside Sales rather than under Manage: a buy-back is money out
        // and money earned, and the people who read the ledger are the
        // people who need to know what is out on loan.
        { href: '/buybacks', label: 'Buy-backs', icon: HandCoins, capability: 'buyback:read', match: '/buybacks' },
      ],
    },
    {
      heading: 'Sell',
      items: [
        { href: '/deals', label: 'Deals', icon: KanbanSquare, capability: 'deal:read', match: '/deals', count: counts.openDeals },
        { href: '/customers', label: 'Customers', icon: Users2, anyOf: ['customer:read', 'customer:own'], match: '/customers' },
        { href: '/requests', label: 'Wanted', icon: Search, capability: 'request:read', match: '/requests', count: counts.openRequests },
        // The trade's own door. Under Sell because answering one is selling,
        // and it carries an attention badge: a dealer waiting on an answer is
        // the one queue here where the clock is somebody else's.
        { href: '/enquiries', label: 'Enquiries', icon: MessageSquare, capability: 'trade:respond', match: '/enquiries', count: counts.tradeEnquiries, attention: counts.tradeEnquiries > 0 },
        { href: '/tasks', label: 'Tasks', icon: CheckSquare, capability: 'task:read', match: '/tasks', count: counts.tasksDue, attention: counts.tasksDue > 0 },
      ],
    },
    {
      heading: 'Needs attention',
      items: [
        { href: '/inventory?unpricedOnly=true', label: 'Unpriced stock', icon: Coins, capability: 'watch:read', count: counts.unpriced, attention: counts.unpriced > 0 },
        { href: '/reports/ageing', label: 'Ageing stock', icon: Clock, capability: 'report:read', count: counts.ageing, attention: counts.ageing > 0 },
        // Beside the other two worklists rather than under the shop settings.
        // It is the same kind of job — a list of stock with something
        // missing — and the shop page is where the sync is wired up, which is
        // a thing somebody does twice a year.
        { href: '/inventory/content', label: 'Shop content', icon: Table2, capability: 'watch:update', match: '/inventory/content' },
      ],
    },
    {
      heading: 'Manage',
      items: [
        { href: '/suppliers', label: 'Suppliers', icon: Building2, capability: 'supplier:read', match: '/suppliers' },
        { href: '/locations', label: 'Locations', icon: MapPin, capability: 'location:read', match: '/locations' },
        { href: '/owners', label: 'Owners', icon: Landmark, capability: 'owner:read', match: '/owners' },
        { href: '/resellers', label: 'Resellers', icon: Store, capability: 'reseller:read', match: '/resellers' },
        { href: '/sales-people', label: 'Sales people', icon: Users2, capability: 'user:read', match: '/sales-people' },
        // Under Manage rather than Needs attention: counting the stock is a
        // job somebody schedules, not one the system nags about.
        { href: '/stock-checks', label: 'Stock checks', icon: ClipboardCheck, capability: 'watch:read', match: '/stock-checks' },
        { href: '/insights', label: 'Insights', icon: LayoutDashboard, capability: 'report:read', match: '/insights' },
        { href: '/reports', label: 'Reports', icon: BarChart3, capability: 'report:read', match: '/reports' },
        /**
         * Somebody who may see only their own month needs a way in too: the
         * Reports entry above is behind `report:read`, which they do not
         * hold, so without this the page exists and nothing points at it —
         * the same as it not existing.
         *
         * Gated on the scope rather than on `report:own`, because the wider
         * roles hold that capability as well (the matrix requires every role
         * above to be a superset of the ones below). A capability filter
         * would therefore put both entries in an owner's rail, pointing at
         * the same section under two names.
         */
        ...(salesScope(role) === 'own'
          ? [{ href: '/reports/people', label: 'My sales', icon: BarChart3, match: '/reports/people' }]
          : []),
      ],
    },
    // Settings, Users and Help live in the account menu and the palette, not
    // the rail (E13). A destination visited weekly does not need to spend
    // rail space on every screen of a working day.
  ]

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        // "Today" carries no capability because every member of staff has it.
        // An outside party is not staff: they get their own page and nothing
        // that reports on the business running around them.
        if (item.anyOf) return canAny(role, item.anyOf)
        if (!item.capability) return !isExternalRole(role)
        return can(role, item.capability)
      }),
    }))
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
