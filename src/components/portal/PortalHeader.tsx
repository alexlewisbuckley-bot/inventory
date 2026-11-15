import { ui } from './ui'

/**
 * The top of every portal page.
 *
 * One component so the stock list, campaigns and orders all open the same
 * way: a hairline of the partner's colour, their mark or a title on the left,
 * the ways around on the right. Before this each page drew its own, and they
 * no longer agreed on padding, width or type.
 */
export function PortalHeader({ brand, eyebrow, title, subtitle, actions, wide = false }: {
  /** The partner's logo or name, where the page leads with it. */
  brand?: React.ReactNode
  eyebrow?: React.ReactNode
  title?: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  /** The stock page runs wider than the rest. */
  wide?: boolean
}) {
  return (
    <header className="border-b border-black/[0.08] bg-white">
      <div className="h-[3px] w-full" style={{ background: 'var(--brand)' }} aria-hidden />
      <div className={`mx-auto flex flex-wrap items-center justify-between gap-x-8 gap-y-4 px-5 py-5 sm:px-8 ${
        wide ? 'max-w-[1480px]' : 'max-w-[1180px]'
      }`}>
        <div className="flex min-w-0 items-center gap-5 sm:gap-6">
          {brand}
          {brand && (eyebrow || title || subtitle) && (
            <span className="hidden h-10 w-px shrink-0 bg-black/10 sm:block" aria-hidden />
          )}
          <div className="min-w-0">
            {eyebrow && <p className={ui.eyebrow}>{eyebrow}</p>}
            {title && <h1 className={`${eyebrow ? 'mt-1' : ''} ${ui.title}`}>{title}</h1>}
            {subtitle && <div className="mt-1 text-[13.5px] leading-snug text-black/65">{subtitle}</div>}
          </div>
        </div>
        {actions && <nav className="flex flex-wrap items-center gap-2">{actions}</nav>}
      </div>
    </header>
  )
}

/** The partner's mark, or their name where there is no logo. */
export function PartnerMark({ token, name, hasLogo }: { token: string; name: string; hasLogo: boolean }) {
  return hasLogo ? (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img src={`/p/${token}/logo`} alt={name} className="h-11 w-auto shrink-0 object-contain" />
  ) : (
    <p className="shrink-0 font-serif text-[28px] leading-none" style={{ color: 'var(--brand)' }}>{name}</p>
  )
}
