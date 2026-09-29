'use client'
import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import type { NavLink } from '@/lib/validation'

/**
 * The top of somebody else's shop.
 *
 * A bar, not a banner. The previous version was a tall block of brand colour
 * with a logo dropped on it, which reads as a page our system printed rather
 * than a shop the reseller runs — there was nowhere to go and nothing above
 * the fold but a title. This is the thing every commerce site has: logo on the
 * left, their own navigation on the right, and the way back to their site.
 *
 * Their links are theirs, so they open in a new tab with `noopener`: this page
 * is not the destination, and a customer who clicks About should not lose the
 * stock list they were looking at.
 */
export function ShopHeader({ name, token, hasLogo, links, website }: {
  name: string
  token: string
  hasLogo: boolean
  links: NavLink[]
  website: string | null
}) {
  const [open, setOpen] = useState(false)
  const hasNav = links.length > 0 || Boolean(website)

  return (
    <header className="sticky top-0 z-30 border-b border-black/[0.07] bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-[72px] max-w-7xl items-center gap-6 px-6 sm:px-10">
        <a href={website ?? undefined} className="flex min-w-0 items-center gap-3" target={website ? '_blank' : undefined} rel="noreferrer noopener">
          {hasLogo ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={`/s/${token}/logo`} alt={name} className="h-9 w-auto max-w-[190px] object-contain" />
          ) : (
            <span className="truncate text-lg font-extrabold tracking-tight text-[#111827]">{name}</span>
          )}
        </a>

        {hasNav && (
          <>
            <nav className="ml-auto hidden items-center gap-7 md:flex" aria-label="Shop">
              {links.map((link) => (
                <a
                  key={`${link.label}-${link.href}`}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm font-semibold text-[#374151] transition hover:text-[color:var(--accent)]"
                >
                  {link.label}
                </a>
              ))}
              {website && (
                <a
                  href={website}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-full px-4 py-2 text-sm font-bold text-white transition hover:brightness-110"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  Visit our site
                </a>
              )}
            </nav>

            <button
              type="button"
              onClick={() => setOpen((on) => !on)}
              aria-expanded={open}
              aria-label={open ? 'Close the menu' : 'Open the menu'}
              className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#E5E7EB] text-[#374151] md:hidden"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </>
        )}
      </div>

      {hasNav && open && (
        <nav className="border-t border-black/[0.07] bg-white px-6 py-3 md:hidden" aria-label="Shop">
          <ul className="flex flex-col">
            {links.map((link) => (
              <li key={`${link.label}-${link.href}`}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block py-2.5 text-base font-semibold text-[#374151]"
                >
                  {link.label}
                </a>
              </li>
            ))}
            {website && (
              <li>
                <a
                  href={website}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-2 block rounded-full py-2.5 text-center text-base font-bold text-white"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  Visit our site
                </a>
              </li>
            )}
          </ul>
        </nav>
      )}
    </header>
  )
}
