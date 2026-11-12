/**
 * The portal's own shell.
 *
 * The same serif as the trade room, and self-hosted for the same reasons: a
 * third-party font request in the critical path of a page somebody else's
 * staff load, and a silent fall back to Times whenever that request is
 * blocked. The application is a tool and is set in a grot; this is a shop.
 */
import '@fontsource-variable/cormorant-garamond/wght.css'
import '@fontsource-variable/cormorant-garamond/wght-italic.css'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="shop-root">{children}</div>
}
