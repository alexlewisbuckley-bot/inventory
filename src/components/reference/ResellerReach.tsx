'use client'
import { useState } from 'react'
import { Check, Copy, ExternalLink, Globe, Loader2, Trash2 } from 'lucide-react'
import { Button, Modal, TextField, useToast } from '@/components/ui'
import { setResellerDomainAction } from '@/app/actions/resellers'
import { checkDomain, looksLikeApex } from '@/lib/domains'

/**
 * Where a reseller points their CNAME.
 *
 * Vercel's general-purpose target, which works for any project. Each project
 * is also given one of its own — a hash against `vercel-dns-NNN.com` — and the
 * Domains screen shows it when a domain is added there. Prefer that value when
 * it is offered; this one is the answer to give somebody who needs to add the
 * record before anybody has opened the dashboard.
 */
const CNAME_TARGET = 'cname.vercel-dns-0.com'

/**
 * How a reseller's customers actually reach the stock.
 *
 * Three ways out of one place, because they are the same question asked by
 * people with different websites. The token link works for everybody and looks
 * like what it is — a secret — so it is no good in front of a customer. A
 * hostname of their own fixes that and costs a DNS record. An embed fixes it
 * without any DNS at all, for the reseller whose site is on a platform they
 * cannot change.
 *
 * The honest part of this panel is the status line. Nothing here can check
 * somebody else's DNS, so nothing here claims to: the domain is "waiting"
 * until a request actually arrives on it, at which point it is live and says
 * so, because a request arriving on that hostname is the only proof that
 * exists.
 */
export function ResellerReach({ reseller, origin, canManage, onClose }: {
  reseller: {
    id: string
    name: string
    publicToken: string
    customDomain: string | null
    customDomainSeenAt: string | null
  }
  origin: string
  canManage: boolean
  onClose: () => void
}) {
  const toast = useToast()
  const [domain, setDomain] = useState(reseller.customDomain ?? '')
  const [saved, setSaved] = useState(reseller.customDomain)
  const [seenAt, setSeenAt] = useState(reseller.customDomainSeenAt)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const checked = checkDomain(domain)
  const snippet = `<div id="stock"></div>\n<script src="${origin}/embed.js" data-shop="${reseller.publicToken}" data-target="stock"></script>`

  const copy = async (what: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(what)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      toast.error('Could not copy', 'Select it and copy it by hand.')
    }
  }

  const save = async (value: string) => {
    setBusy(true)
    const result = await setResellerDomainAction(reseller.id, value)
    setBusy(false)
    if (!result.ok) {
      toast.error('Could not save that domain', result.errors?.customDomain ?? result.message)
      return
    }
    setSaved(result.domain ?? null)
    setDomain(result.domain ?? '')
    setSeenAt(null)
    toast.success(result.message ?? 'Saved')
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Where ${reseller.name} sells`}
      description="Their own domain, or a block on the site they already have."
      size="lg"
      footer={<Button variant="ghost" onClick={onClose}>Done</Button>}
    >
      <div className="flex flex-col gap-7">
        <section>
          <h3 className="flex items-center gap-2 text-small font-bold text-content-primary">
            <Globe className="h-4 w-4 text-content-accent" aria-hidden />
            Their own domain
          </h3>
          <p className="mt-1 text-caption text-content-secondary">
            The shop answers on a hostname of theirs, with nothing of ours in the address bar. The
            token link keeps working either way.
          </p>

          <div className="mt-3 flex items-end gap-2">
            <TextField
              label="Hostname"
              className="flex-1"
              placeholder="shop.theirsite.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              disabled={!canManage || busy}
              error={domain && !checked.ok ? checked.error : undefined}
              hint={checked.value && looksLikeApex(checked.value)
                ? 'A bare domain cannot take a CNAME at most registrars. A subdomain such as shop. or watches. is the easy route.'
                : undefined}
            />
            {canManage && (
              <Button
                className="mb-0.5"
                onClick={() => save(domain)}
                loading={busy}
                disabled={!checked.ok || (checked.value ?? null) === saved}
              >
                Save
              </Button>
            )}
            {canManage && saved && (
              <button
                type="button"
                onClick={() => save('')}
                disabled={busy}
                aria-label="Remove the custom domain"
                className="mb-1.5 flex h-9 w-9 items-center justify-center rounded-sm text-content-secondary hover:bg-state-danger/10 hover:text-state-danger"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>

          {saved && (
            <>
              <div className="mt-3 flex items-center gap-2 rounded-md bg-surface-subtle px-3.5 py-2.5">
                {seenAt ? (
                  <>
                    <Check className="h-4 w-4 shrink-0 text-state-success" aria-hidden />
                    <span className="text-small text-content-primary">
                      Live — the first request arrived {new Date(seenAt).toLocaleDateString()}.
                    </span>
                    <a
                      href={`https://${saved}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="ml-auto flex h-7 w-7 items-center justify-center rounded-sm text-content-secondary hover:bg-surface-raised hover:text-content-primary"
                      aria-label={`Open https://${saved}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  </>
                ) : (
                  <>
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-content-secondary" aria-hidden />
                    <span className="text-small text-content-secondary">
                      Waiting for the first request on {saved}. It turns live by itself once the DNS
                      has propagated — nothing here needs pressing.
                    </span>
                  </>
                )}
              </div>

              {/* Written as the two jobs they are, because they are done by two
                  different people and the one that gets forgotten is ours. */}
              <ol className="mt-3 flex flex-col gap-2.5 text-caption text-content-secondary">
                <li className="flex gap-2.5">
                  <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-content-primary text-[10px] font-bold text-surface-raised">1</span>
                  <span>
                    <strong className="text-content-primary">They add a DNS record.</strong>{' '}
                    A <code className="rounded-xs bg-surface-subtle px-1 font-mono">CNAME</code> on{' '}
                    <code className="rounded-xs bg-surface-subtle px-1 font-mono">{saved.split('.')[0]}</code>{' '}
                    pointing at{' '}
                    <code className="rounded-xs bg-surface-subtle px-1 font-mono">{CNAME_TARGET}</code>.
                    <button
                      type="button"
                      onClick={() => copy('cname', CNAME_TARGET)}
                      className="ml-1.5 font-bold text-content-accent hover:underline"
                    >
                      {copied === 'cname' ? 'Copied' : 'Copy'}
                    </button>
                    <span className="mt-0.5 block text-content-secondary">
                      If step 2 has already been done, use the target shown on Vercel&rsquo;s Domains
                      screen instead — each project is given one of its own, and that is the one it
                      checks for.
                    </span>
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-content-primary text-[10px] font-bold text-surface-raised">2</span>
                  <span>
                    <strong className="text-content-primary">You add the domain to the hosting project</strong>{' '}
                    — in Vercel, under the project&rsquo;s Domains settings. Without this the host
                    never reaches us at all and their browser shows a hosting error rather than the
                    shop. The certificate is issued automatically once it does.
                  </span>
                </li>
              </ol>

              <p className="mt-3 text-caption text-content-secondary">
                Worth saying out loud: a shop on a public hostname is a public shop. The token link
                was unguessable; a domain is not, and anyone who finds it sees the same stock and
                prices a customer would.
              </p>
            </>
          )}
        </section>

        <section className="border-t border-line-subtle pt-6">
          <h3 className="text-small font-bold text-content-primary">On the site they already have</h3>
          <p className="mt-1 text-caption text-content-secondary">
            For a reseller who does not want a second website. Two lines into any page of theirs and
            the live stock appears inside it — their navigation above, their footer below, no DNS to
            arrange. It resizes itself to whatever it is showing.
          </p>
          {/* Wrapped rather than scrolled: a snippet with its right-hand half
              out of sight is one somebody copies half of. */}
          <pre className="mt-3 whitespace-pre-wrap break-all rounded-md bg-surface-subtle px-3.5 py-3 font-mono text-caption leading-relaxed text-content-primary">
            {snippet}
          </pre>
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={copied === 'embed'
                ? <Check className="h-3.5 w-3.5" />
                : <Copy className="h-3.5 w-3.5" />}
              onClick={() => copy('embed', snippet)}
            >
              {copied === 'embed' ? 'Copied' : 'Copy the snippet'}
            </Button>
            <a
              href={`${origin}/s/${reseller.publicToken}/embed`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-caption font-bold text-content-accent hover:underline"
            >
              Preview what they will see
            </a>
          </div>
          <p className="mt-2 text-caption text-content-secondary">
            The snippet carries their token, so it is as private as the link is — reissuing the link
            stops the embed too, and they will need the new snippet.
          </p>
        </section>
      </div>
    </Modal>
  )
}
