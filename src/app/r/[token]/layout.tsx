/**
 * A recipient's own shell. The same serif as the portal and the trade room,
 * self-hosted: a third-party font request in the critical path of a page
 * somebody's employee opens once, on a phone, probably on mobile data.
 */
import '@fontsource-variable/cormorant-garamond/wght.css'
import '@fontsource-variable/cormorant-garamond/wght-italic.css'

export default function RecipientLayout({ children }: { children: React.ReactNode }) {
  return <div className="shop-root">{children}</div>
}
