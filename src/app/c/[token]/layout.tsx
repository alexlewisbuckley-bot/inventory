/**
 * The catalogue link's own shell.
 *
 * The same typeface as the reseller trade room, self-hosted for the same
 * reasons: a third-party request in the critical path of a page somebody
 * else loads, and a silent fall back to Times whenever that request is
 * blocked.
 *
 * A serif carries the piece names. The application is a tool and is set in a
 * grot; this is a list of watches, and a watch listed in the same face as a
 * settings panel reads like a settings panel.
 */
import '@fontsource-variable/cormorant-garamond/wght.css'
import '@fontsource-variable/cormorant-garamond/wght-italic.css'

export default function CatalogueLinkLayout({ children }: { children: React.ReactNode }) {
  return <div className="shop-root">{children}</div>
}
