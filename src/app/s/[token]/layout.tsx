/**
 * The shop window's own shell.
 *
 * Self-hosted like the application's typeface and for the same reasons: a
 * third-party request in the critical path of a page somebody else's customers
 * load, and a silent fall back to Times whenever that request is blocked.
 *
 * A serif carries the piece names and the prices. The application is a tool and
 * is set in a grot; this is a shop, and the difference between the two is
 * mostly typographic — a watch listed in the same face as a settings panel
 * reads like a settings panel.
 */
import '@fontsource-variable/cormorant-garamond/wght.css'
import '@fontsource-variable/cormorant-garamond/wght-italic.css'

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return <div className="shop-root">{children}</div>
}
