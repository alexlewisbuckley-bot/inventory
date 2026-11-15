import { LayoutGrid, LogOut, Megaphone, Receipt, Trophy } from 'lucide-react'
import { leavePortalAction } from '@/app/actions/partner-portal'
import { ui } from './ui'

export type PortalSection = 'stock' | 'campaigns' | 'leaderboards' | 'orders'

const LINKS: Array<{ key: PortalSection; label: string; path: string; Icon: typeof Receipt }> = [
  { key: 'stock', label: 'Stock', path: '', Icon: LayoutGrid },
  { key: 'campaigns', label: 'Campaigns', path: '/campaigns', Icon: Megaphone },
  { key: 'leaderboards', label: 'Leaderboards', path: '/leaderboards', Icon: Trophy },
  { key: 'orders', label: 'Orders', path: '/orders', Icon: Receipt },
]

/**
 * The same way around on every portal page.
 *
 * Each page used to carry its own handful of links — "Back to stock" here,
 * "Orders" there — so where you could get to depended on where you were.
 * One row, the page you are on filled in the partner's colour.
 */
export function PortalNav({ token, active }: { token: string; active: PortalSection }) {
  return (
    <>
      {LINKS.map(({ key, label, path, Icon }) => {
        const on = key === active
        return (
          <a
            key={key}
            href={`/p/${token}${path}`}
            aria-current={on ? 'page' : undefined}
            className={on ? `${ui.outline} !border-transparent !text-white hover:!bg-[var(--brand)]` : ui.outline}
            style={on ? { backgroundColor: 'var(--brand)' } : undefined}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
          </a>
        )
      })}
      <form action={leavePortalAction.bind(null, token)}>
        <button type="submit" className={ui.ghost}>
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          Sign out
        </button>
      </form>
    </>
  )
}
