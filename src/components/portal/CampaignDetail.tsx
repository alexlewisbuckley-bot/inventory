'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { Check, Copy, Trash2 } from 'lucide-react'
import {
  addRecipientsAction, closeCampaignAction, openCampaignAction,
  setShortlistAction, type CampaignState,
} from '@/app/actions/partner-campaigns'
import { removeRecipientAction } from '@/app/actions/partner-campaigns'
import { CAMPAIGN_STATUS_LABELS, type CampaignKind, type CampaignStatus } from '@/lib/enums'

const INITIAL: CampaignState = { ok: false, message: '' }

function money(base: number): string {
  return `AED ${Math.round(base / 100).toLocaleString('en-GB')}`
}

export interface RecipientRow {
  id: string
  name: string
  email: string | null
  token: string
  claimedAt: string | null
  claimNote: string | null
  chosenBrand: string | null
  chosenModel: string | null
  chosenModelName: string | null
}

export interface StockRow {
  id: string
  brandName: string
  model: string | null
  modelName: string | null
  priceGbp: number
  imageIds: string[]
}

/**
 * One campaign: who is on it, what they may choose from, and the links.
 *
 * Laid out in the order somebody does it — add the people, pick the watches,
 * then open it — because the order is not obvious and getting it wrong means
 * sending out a link that opens an empty page.
 */
export function CampaignDetail({ token, campaign, recipients, stock, shortlist }: {
  token: string
  campaign: {
    id: string
    name: string
    intro: string | null
    kind: CampaignKind
    budgetBase: number | null
    status: CampaignStatus
  }
  recipients: RecipientRow[]
  stock: StockRow[]
  shortlist: string[]
}) {
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<string[]>(shortlist)
  const [note, setNote] = useState<string | null>(null)
  const live = campaign.status === 'OPEN'
  const chosen = recipients.filter((person) => person.claimedAt).length

  const saveShortlist = async () => {
    setBusy(true)
    const result = await setShortlistAction(token, campaign.id, picked)
    setBusy(false)
    setNote(result.message)
  }

  const flip = async () => {
    setBusy(true)
    const result = live
      ? await closeCampaignAction(token, campaign.id)
      : await openCampaignAction(token, campaign.id)
    setBusy(false)
    setNote(result.message)
    if (result.ok) window.location.reload()
  }

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-black/10 px-5 py-7 sm:px-8">
        <div className="mx-auto max-w-[1180px]">
          <Link
            href={`/p/${token}/campaigns`}
            className="text-[12px] uppercase tracking-[0.08em] text-black/40 hover:text-black/70"
          >
            All campaigns
          </Link>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div>
              <p className="font-serif text-[27px] leading-tight text-black">{campaign.name}</p>
              <p className="mt-1 text-[13px] text-black/55">
                {campaign.kind === 'BUDGET'
                  ? `${campaign.budgetBase ? money(campaign.budgetBase) : 'No amount set'} each · `
                  : 'A shortlist · '}
                {chosen} of {recipients.length} chosen · {CAMPAIGN_STATUS_LABELS[campaign.status]}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void flip()}
              disabled={busy}
              className="h-11 px-5 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-white disabled:opacity-60"
              style={{ backgroundColor: live ? '#6b7280' : 'var(--brand, #04173A)' }}
            >
              {live ? 'Close it' : 'Open it'}
            </button>
          </div>
          {note && <p className="mt-2 text-[12.5px] text-black/60">{note}</p>}
        </div>
      </header>

      <div className="mx-auto max-w-[1180px] space-y-10 px-5 py-8 sm:px-8">
        <section>
          <h2 className="font-serif text-[20px] text-black">Who it is for</h2>
          <p className="mt-1 text-[13px] text-black/55">
            Everyone gets their own link. Send it however you normally reach them — the link
            is personal, so whoever opens it is recorded as them.
          </p>

          {recipients.length > 0 && (
            <ul className="mt-4 divide-y divide-black/10 border-y border-black/10">
              {recipients.map((person) => (
                <RecipientLine
                  key={person.id}
                  token={token}
                  campaignId={campaign.id}
                  person={person}
                  live={live}
                />
              ))}
            </ul>
          )}

          <AddPeople token={token} campaignId={campaign.id} />
        </section>

        {campaign.kind === 'SHORTLIST' && (
          <section>
            <h2 className="font-serif text-[20px] text-black">What they choose from</h2>
            <p className="mt-1 text-[13px] text-black/55">
              Pick the watches. Nobody sees a price — and a watch stays on sale to everyone
              else until one of your people actually chooses it.
            </p>

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void saveShortlist()}
                disabled={busy}
                className="h-10 px-4 text-[12.5px] font-semibold uppercase tracking-[0.07em] text-white disabled:opacity-60"
                style={{ backgroundColor: 'var(--brand, #04173A)' }}
              >
                Save shortlist
              </button>
              <p className="text-[13px] text-black/55">
                {picked.length} {picked.length === 1 ? 'watch' : 'watches'} picked
              </p>
            </div>

            <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4 xl:grid-cols-6">
              {stock.map((item) => {
                const on = picked.includes(item.id)
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPicked((current) => on
                        ? current.filter((id) => id !== item.id)
                        : [...current, item.id])}
                      className={`block w-full text-left ${on ? '' : 'opacity-70 hover:opacity-100'}`}
                    >
                      <span className={`relative block aspect-square w-full overflow-hidden border-2 bg-black/[0.02] ${
                        on ? 'border-black' : 'border-transparent'
                      }`}>
                        {item.imageIds[0] && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={`/p/${token}/image/${item.imageIds[0]}`}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-contain p-2 mix-blend-multiply"
                          />
                        )}
                        {on && (
                          <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center bg-black text-white">
                            <Check className="h-3 w-3" aria-hidden />
                          </span>
                        )}
                      </span>
                      <span className="mt-2 line-clamp-2 block min-h-[2.4em] text-[12.5px] leading-snug text-black">
                        {[item.brandName, item.model, item.modelName].filter(Boolean).join(' ')}
                      </span>
                      <span className="block text-[12px] tabular-nums text-black/50">
                        {money(item.priceGbp)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>
    </main>
  )
}

function RecipientLine({ token, campaignId, person, live }: {
  token: string
  campaignId: string
  person: RecipientRow
  /** Whether the campaign is running, and so whether the link is worth sending. */
  live: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [gone, setGone] = useState(false)

  const link = typeof window === 'undefined' ? '' : `${window.location.origin}/r/${person.token}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // A clipboard that refuses is not worth a dialog: the link is on screen.
    }
  }

  const remove = async () => {
    setBusy(true)
    const result = await removeRecipientAction(token, campaignId, person.id)
    setBusy(false)
    if (result.ok) setGone(true)
  }

  if (gone) return null

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] text-black">{person.name}</p>
        {person.email && <p className="truncate text-[12.5px] text-black/45">{person.email}</p>}
      </div>

      {person.claimedAt ? (
        /*
         * What they chose, where the link used to be.
         *
         * Once somebody has chosen, their link is of no further use to anybody
         * and the only question about that row is what they picked.
         */
        <p className="flex items-center gap-1.5 text-[13px] text-black/70">
          <Check className="h-3.5 w-3.5" aria-hidden />
          {[person.chosenBrand, person.chosenModel, person.chosenModelName]
            .filter(Boolean).join(' ') || 'Chosen'}
        </p>
      ) : (
        <>
          {/* Not offered until the campaign is open: the link exists from the
              moment somebody is added, and sending it early lands them on a
              page with nothing on it. */}
          <button
            type="button"
            onClick={() => void copy()}
            disabled={!live}
            title={live ? undefined : 'Open the campaign first.'}
            className="flex items-center gap-1.5 text-[12.5px] text-black/50 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {copied ? 'Copied' : live ? 'Copy link' : 'Open it first'}
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            aria-label={`Remove ${person.name}`}
            className="text-black/30 hover:text-[#b42318] disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </>
      )}
    </li>
  )
}

/**
 * Adding people, by pasting them.
 *
 * The list already exists — in a spreadsheet, in an email from a manager — and
 * the alternative is somebody filling in a two-field form forty times. One per
 * line, name first, email after a comma if there is one.
 */
function AddPeople({ token, campaignId }: { token: string; campaignId: string }) {
  const [state, action] = useFormState<CampaignState, FormData>(
    addRecipientsAction.bind(null, token, campaignId),
    INITIAL,
  )

  if (state.ok && typeof window !== 'undefined') window.location.reload()

  return (
    <form action={action} className="mt-5">
      <label className="block">
        <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-black/55">
          Add people
        </span>
        <textarea
          name="people"
          rows={3}
          placeholder={'Priya Raman, priya@company.com\nTom Clarke, tom@company.com'}
          className="mt-1 w-full border border-black/15 px-3 py-2 text-[14px] text-black outline-none placeholder:text-black/30 focus:border-black/50"
        />
        <span className="mt-1 block text-[12px] text-black/45">
          One per line. Name first, email after a comma — paste straight from a spreadsheet.
        </span>
      </label>
      {state.message && !state.ok && (
        <p role="alert" className="mt-2 text-[12.5px] text-[#b42318]">{state.message}</p>
      )}
      <AddButton />
    </form>
  )
}

function AddButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-3 h-10 border border-black/15 px-4 text-[12.5px] font-semibold uppercase tracking-[0.07em] text-black hover:border-black/50 disabled:opacity-60"
    >
      {pending ? 'Adding…' : 'Add them'}
    </button>
  )
}
