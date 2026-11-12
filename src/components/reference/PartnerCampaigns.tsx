'use client'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Check, Copy, Gift, Plus, Trash2 } from 'lucide-react'
import {
  Button, Card, Chip, EmptyState, Modal, TextField, TextareaField, useCurrency, useToast,
} from '@/components/ui'
import {
  saveCampaignForPartnerAction, addRecipientsForPartnerAction,
  removeRecipientForPartnerAction, setShortlistForPartnerAction,
  setCampaignLiveAction, deleteCampaignForPartnerAction,
} from '@/app/actions/partners'
import type { ActionState } from '@/app/actions/auth'
import {
  CAMPAIGN_STATUS_LABELS, type CampaignKind, type CampaignStatus,
} from '@/lib/enums'

const INITIAL: ActionState = { ok: false }

export interface CampaignView {
  id: string
  name: string
  intro: string | null
  kind: CampaignKind
  budgetBase: number | null
  status: CampaignStatus
  recipientCount: number
  claimedCount: number
  itemCount: number
}

export interface RecipientView {
  id: string
  name: string
  email: string | null
  token: string
  claimedAt: string | null
  chosenBrand: string | null
  chosenModel: string | null
  chosenModelName: string | null
}

export interface StockView {
  id: string
  brandName: string
  model: string | null
  modelName: string | null
  priceGbp: number
  imageIds: string[]
}

/**
 * Campaigns, run from here rather than only from the partner's portal.
 *
 * Alex: "I cant see anywhere to run a campaign." They were reachable only
 * through a company's own link, which meant the people who sell these
 * arrangements could not see one — and most partners will not want to set
 * their own up anyway. An estate agency rewarding fifteen staff does not want
 * a login; it wants somebody here to put the list in and send the links back.
 *
 * The same service the portal uses, so a campaign built here and one built
 * there are the same record and neither screen can drift into showing a
 * different truth.
 */
export function PartnerCampaigns({ partnerId, portalToken, campaigns, recipients, stock, shortlists, canManage }: {
  partnerId: string
  portalToken: string | null
  campaigns: CampaignView[]
  /** Keyed by campaign id, so one page can open any of them. */
  recipients: Record<string, RecipientView[]>
  stock: StockView[]
  shortlists: Record<string, string[]>
  canManage: boolean
}) {
  const { money } = useCurrency()
  const toast = useToast()
  const [making, setMaking] = useState(false)
  const [editing, setEditing] = useState<CampaignView | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const flip = async (campaign: CampaignView) => {
    setBusy(true)
    const result = await setCampaignLiveAction(partnerId, campaign.id, campaign.status !== 'OPEN')
    setBusy(false)
    if (result.ok) toast.success(campaign.status === 'OPEN' ? 'Closed' : 'Open', result.message)
    else toast.error('Could not change that campaign', result.message)
  }

  const remove = async (campaign: CampaignView) => {
    setBusy(true)
    const result = await deleteCampaignForPartnerAction(partnerId, campaign.id)
    setBusy(false)
    if (result.ok) toast.success('Campaign removed')
    else toast.error('Could not remove that campaign', result.message)
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line-subtle px-5 py-4">
        <Gift className="h-4 w-4 text-content-secondary" aria-hidden />
        <p className="text-body font-bold text-content-primary">Reward campaigns</p>
        {campaigns.length > 0 && <Chip tone="neutral">{campaigns.length}</Chip>}
        {canManage && (
          <Button
            size="sm" variant="ghost" className="ml-auto"
            icon={<Plus className="h-4 w-4" />}
            onClick={() => setMaking(true)}
          >
            New campaign
          </Button>
        )}
      </div>

      {campaigns.length === 0 ? (
        <EmptyState
          icon={<Gift className="h-6 w-6" aria-hidden />}
          title="No campaigns yet"
          description="A campaign is a list of their people and something for each to choose from — either a shortlist you pick together, or an amount each person can spend. Everyone gets their own link."
        />
      ) : (
        <ul className="divide-y divide-line-subtle">
          {campaigns.map((campaign) => {
            const showing = open === campaign.id
            return (
              <li key={campaign.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <button
                    type="button"
                    onClick={() => setOpen(showing ? null : campaign.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-body font-semibold text-content-primary">
                      {campaign.name}
                    </p>
                    <p className="truncate text-small text-content-secondary">
                      {campaign.kind === 'BUDGET'
                        ? `${campaign.budgetBase ? money(campaign.budgetBase) : 'No amount set'} each`
                        : `${campaign.itemCount} ${campaign.itemCount === 1 ? 'watch' : 'watches'} to choose from`}
                      {' · '}
                      {/* Chosen out of invited: the question is always who has
                          not picked yet, and a total alone does not answer it. */}
                      {campaign.claimedCount} of {campaign.recipientCount} chosen
                    </p>
                  </button>

                  <Chip tone={campaign.status === 'OPEN' ? 'success' : 'neutral'}>
                    {CAMPAIGN_STATUS_LABELS[campaign.status]}
                  </Chip>

                  {canManage && (
                    <div className="flex items-center gap-1.5">
                      {/* "Open it", not "Open": the chip beside this already
                          says OPEN, and a button wearing the same word reads
                          as a label rather than as something to press. */}
                      <Button size="sm" variant="ghost" onClick={() => void flip(campaign)} disabled={busy}>
                        {campaign.status === 'OPEN' ? 'Close it' : 'Open it'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(campaign)}>
                        Edit
                      </Button>
                      <button
                        type="button"
                        aria-label={`Remove ${campaign.name}`}
                        onClick={() => void remove(campaign)}
                        disabled={busy}
                        className="rounded p-1.5 text-content-muted hover:bg-surface-subtle hover:text-state-danger"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  )}
                </div>

                {showing && (
                  <CampaignBody
                    partnerId={partnerId}
                    campaign={campaign}
                    recipients={recipients[campaign.id] ?? []}
                    stock={stock}
                    shortlist={shortlists[campaign.id] ?? []}
                    canManage={canManage}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {!portalToken && campaigns.length > 0 && (
        <p className="border-t border-line-subtle px-5 py-3 text-small text-state-warning">
          This partner has no portal open, so nobody at the company can see their campaigns —
          the recipients&rsquo; own links still work.
        </p>
      )}

      {(making || editing) && (
        <CampaignForm
          partnerId={partnerId}
          campaign={editing}
          onDone={() => { setMaking(false); setEditing(null) }}
          onSaved={() => toast.success(editing ? 'Campaign updated' : 'Campaign created')}
        />
      )}
    </Card>
  )
}

/** Who is on it, their links, and what they may choose from. */
function CampaignBody({ partnerId, campaign, recipients, stock, shortlist, canManage }: {
  partnerId: string
  campaign: CampaignView
  recipients: RecipientView[]
  stock: StockView[]
  shortlist: string[]
  canManage: boolean
}) {
  const { money } = useCurrency()
  const toast = useToast()
  const [picked, setPicked] = useState<string[]>(shortlist)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    const result = await setShortlistForPartnerAction(partnerId, campaign.id, picked)
    setBusy(false)
    if (result.ok) toast.success('Shortlist saved', `${picked.length} on the list.`)
    else toast.error('Could not save that shortlist', result.message)
  }

  return (
    <div className="mt-4 space-y-5 border-t border-line-subtle pt-4">
      {campaign.intro && (
        <p className="text-small text-content-secondary">
          They read: &ldquo;{campaign.intro}&rdquo;
        </p>
      )}

      <section>
        <p className="text-caption font-semibold uppercase tracking-wide text-content-secondary">
          Who it is for
        </p>
        {recipients.length > 0 && (
          <ul className="mt-2 divide-y divide-line-subtle">
            {recipients.map((person) => (
              <RecipientLine
                key={person.id}
                partnerId={partnerId}
                campaignId={campaign.id}
                person={person}
                live={campaign.status === 'OPEN'}
                canManage={canManage}
              />
            ))}
          </ul>
        )}
        {canManage && <AddPeople partnerId={partnerId} campaignId={campaign.id} />}
      </section>

      {campaign.kind === 'SHORTLIST' && canManage && (
        <section>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-caption font-semibold uppercase tracking-wide text-content-secondary">
              What they choose from
            </p>
            <p className="text-small text-content-secondary">
              {picked.length} picked
            </p>
            <Button size="sm" variant="secondary" className="ml-auto" onClick={() => void save()} disabled={busy}>
              Save shortlist
            </Button>
          </div>
          <p className="mt-1 text-small text-content-secondary">
            Nobody sees a price on a shortlist, and a watch stays on sale to everyone else
            until one of their people actually chooses it.
          </p>

          <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5 xl:grid-cols-8">
            {stock.map((item) => {
              const on = picked.includes(item.id)
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    title={`${[item.brandName, item.model, item.modelName].filter(Boolean).join(' ')} · ${money(item.priceGbp)}`}
                    onClick={() => setPicked((current) => on
                      ? current.filter((id) => id !== item.id)
                      : [...current, item.id])}
                    className={`relative block aspect-square w-full overflow-hidden rounded-md border-2 bg-surface-subtle ${
                      on ? 'border-accent-primary' : 'border-transparent opacity-70 hover:opacity-100'
                    }`}
                  >
                    {item.imageIds[0] && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={`/api/images/${item.imageIds[0]}`}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-contain p-1"
                      />
                    )}
                    {on && (
                      <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent-primary text-content-on-accent">
                        <Check className="h-2.5 w-2.5" aria-hidden />
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

function RecipientLine({ partnerId, campaignId, person, live, canManage }: {
  partnerId: string
  campaignId: string
  person: RecipientView
  /** Whether the campaign is actually running, and so whether links work. */
  live: boolean
  canManage: boolean
}) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const [gone, setGone] = useState(false)
  const [busy, setBusy] = useState(false)

  const link = typeof window === 'undefined' ? '' : `${window.location.origin}/r/${person.token}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy', 'Select the link and copy it by hand.')
    }
  }

  const remove = async () => {
    setBusy(true)
    const result = await removeRecipientForPartnerAction(partnerId, campaignId, person.id)
    setBusy(false)
    if (result.ok) setGone(true)
    else toast.error('Could not remove them', result.message)
  }

  if (gone) return null

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-small text-content-primary">{person.name}</p>
        {person.email && <p className="truncate text-caption text-content-secondary">{person.email}</p>}
      </div>

      {person.claimedAt ? (
        /* Once somebody has chosen, their link is of no further use and the
           only question about that row is what they picked. */
        <p className="flex items-center gap-1.5 text-small text-content-secondary">
          <Check className="h-3.5 w-3.5 text-state-good" aria-hidden />
          {[person.chosenBrand, person.chosenModel, person.chosenModelName]
            .filter(Boolean).join(' ') || 'Chosen'}
        </p>
      ) : (
        <>
          {/*
            * The link is only offered once the campaign is open.
            *
            * It existed from the moment somebody was added, which is how the
            * first one went out before the campaign was opened and landed the
            * recipient on a page with nothing on it. The link is real either
            * way; what changes is whether it is worth sending.
            */}
          <button
            type="button"
            onClick={() => void copy()}
            disabled={!live}
            title={live ? undefined : 'Open the campaign first — the link works, but there is nothing on it yet.'}
            className="flex items-center gap-1.5 text-caption text-content-secondary hover:text-content-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {copied ? 'Copied' : live ? 'Copy their link' : 'Open it first'}
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              aria-label={`Remove ${person.name}`}
              className="rounded p-1 text-content-muted hover:text-state-danger disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </>
      )}
    </li>
  )
}

/**
 * Adding people, by pasting them.
 *
 * The list arrives from the company as a spreadsheet or an email, and the
 * alternative is somebody here filling in a two-field form forty times.
 */
function AddPeople({ partnerId, campaignId }: { partnerId: string; campaignId: string }) {
  const toast = useToast()
  const [state, action] = useFormState(
    addRecipientsForPartnerAction.bind(null, partnerId, campaignId),
    INITIAL,
  )

  if (state.ok) toast.success('Added', state.message)

  return (
    <form action={action} className="mt-3">
      <TextareaField
        name="people"
        label="Add people"
        rows={2}
        placeholder={'Priya Raman, priya@company.com\nTom Clarke, tom@company.com'}
        hint="One per line, name first — paste straight from their spreadsheet."
        error={state.errors?.people}
      />
      {state.message && !state.ok && (
        <p role="alert" className="mt-1 text-small text-state-danger">{state.message}</p>
      )}
      <AddButton />
    </form>
  )
}

function AddButton() {
  const { pending } = useFormStatus()
  return <Button type="submit" size="sm" variant="secondary" className="mt-2" loading={pending}>Add them</Button>
}

function CampaignForm({ partnerId, campaign, onDone, onSaved }: {
  partnerId: string
  campaign: CampaignView | null
  onDone: () => void
  onSaved: () => void
}) {
  const [state, action] = useFormState(saveCampaignForPartnerAction.bind(null, partnerId), INITIAL)
  const [kind, setKind] = useState<CampaignKind>(campaign?.kind ?? 'SHORTLIST')

  if (state.ok) {
    onSaved()
    onDone()
  }

  return (
    <Modal open title={campaign ? `Edit ${campaign.name}` : 'New campaign'} onClose={onDone}>
      <form action={action} className="space-y-4">
        {campaign && <input type="hidden" name="id" value={campaign.id} />}

        <TextField name="name" label="Name" required
          defaultValue={campaign?.name ?? ''}
          placeholder="Q4 top performers"
          error={state.errors?.name} />

        <fieldset>
          <legend className="text-caption font-semibold text-content-secondary">
            How their people choose
          </legend>
          {/* Explained at the moment of choosing between them: whoever sets one
              of these up does it twice a year and has read nothing first. */}
          <div className="mt-2 space-y-2">
            <KindOption
              value="SHORTLIST" current={kind} onPick={setKind}
              title="A shortlist you choose"
              detail="You pick the watches with them. Everyone chooses one, and nobody sees a price."
            />
            <KindOption
              value="BUDGET" current={kind} onPick={setKind}
              title="An amount each person can spend"
              detail="Everyone sees what they can afford at this partner's rate, with prices, and picks one."
            />
          </div>
        </fieldset>

        {kind === 'BUDGET' && (
          <TextField
            name="budget"
            label="Amount each person can spend"
            inputMode="decimal"
            required
            defaultValue={campaign?.budgetBase ? String(campaign.budgetBase / 100) : ''}
            placeholder="20000"
            hint="In AED, at their rate — what it costs them, not our asking price."
            error={state.errors?.budget}
          />
        )}

        <TextareaField
          name="intro"
          label="What their people read at the top of the page"
          rows={3}
          defaultValue={campaign?.intro ?? ''}
          placeholder="In recognition of an exceptional year…"
        />

        {state.message && !state.ok && (
          <p role="alert" className="text-small text-state-danger">{state.message}</p>
        )}

        <div className="flex justify-end gap-2.5">
          <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
          <SaveCampaign editing={campaign !== null} />
        </div>
      </form>
    </Modal>
  )
}

function KindOption({ value, current, onPick, title, detail }: {
  value: CampaignKind
  current: CampaignKind
  onPick: (value: CampaignKind) => void
  title: string
  detail: string
}) {
  const picked = current === value
  return (
    <label className={`flex cursor-pointer gap-3 rounded-md border p-3 ${
      picked ? 'border-accent-primary' : 'border-line-subtle'
    }`}>
      <input
        type="radio" name="kind" value={value} checked={picked}
        onChange={() => onPick(value)}
        className="mt-1 accent-[rgb(var(--c-accent-primary))]"
      />
      <span>
        <span className="block text-small font-semibold text-content-primary">{title}</span>
        <span className="mt-0.5 block text-caption text-content-secondary">{detail}</span>
      </span>
    </label>
  )
}

function SaveCampaign({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus()
  return <Button type="submit" loading={pending}>{editing ? 'Save' : 'Create campaign'}</Button>
}
