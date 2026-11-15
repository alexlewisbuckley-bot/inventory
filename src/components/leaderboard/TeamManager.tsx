'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Pencil, Plus, Trash2, UserPlus, Users } from 'lucide-react'
import {
  removeTeamMemberAction, saveTeamMemberAction,
  type LeaderboardScope, type LeaderboardState,
} from '@/app/actions/leaderboards'
import { ui, brandFill } from '@/components/portal/ui'

export interface TeamMemberView {
  id: string
  name: string
  subtitle: string | null
  hasPhoto: boolean
  photoVersion: number | null
}

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

/**
 * A partner's team: their agents and their photos, kept once.
 *
 * Every leaderboard draws on this, so the work of typing names and finding
 * headshots happens here and only here. Cards rather than a table, because
 * the thing people check is the face — is that the right photo of Sam.
 */
export function TeamManager({ scope, team, photoBase }: {
  scope: LeaderboardScope
  team: TeamMemberView[]
  /** `${photoBase}/${memberId}` serves a member's photo. */
  photoBase: string
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<string | null>(null)
  const [flash, setFlash] = useState<LeaderboardState | null>(null)
  const [pending, start] = useTransition()
  const done = (result: LeaderboardState) => {
    setFlash(result)
    if (result.ok) router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[15px] font-semibold text-black"><Users className="h-4 w-4" aria-hidden />Your agents</p>
          <p className="mt-0.5 text-[13px] text-black/55">
            Add your people and their photos once. Every leaderboard can then take them with a tick — or all of them at once.
          </p>
        </div>
        <p className="text-[13px] tabular-nums text-black/50">{team.length} {team.length === 1 ? 'agent' : 'agents'}</p>
      </div>

      {flash?.message && (
        <p role="status" className={`rounded-[10px] px-4 py-2.5 text-[13px] ${flash.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {flash.message}
        </p>
      )}

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {team.map((member) => (
          <li key={member.id}>
            {editing === member.id ? (
              <MemberForm
                member={member}
                photoSrc={member.hasPhoto ? `${photoBase}/${member.id}?v=${member.photoVersion ?? 0}` : null}
                busy={pending}
                onCancel={() => setEditing(null)}
                onSave={(data) => start(async () => {
                  const result = await saveTeamMemberAction(scope, member.id, data)
                  done(result)
                  if (result.ok) setEditing(null)
                })}
              />
            ) : (
              <div className={`${ui.card} group flex h-full items-center gap-3 p-3.5`}>
                <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-black/[0.06] text-[17px] font-semibold text-black/45">
                  {member.hasPhoto
                    /* eslint-disable-next-line @next/next/no-img-element */
                    ? <img src={`${photoBase}/${member.id}?v=${member.photoVersion ?? 0}`} alt="" className="h-full w-full object-cover" />
                    : initials(member.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-black">{member.name}</p>
                  <p className="truncate text-[12.5px] text-black/45">{member.subtitle || (member.hasPhoto ? '' : 'No photo yet')}</p>
                </div>
                <div className="flex shrink-0 flex-col opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <button type="button" className={ui.iconButton} aria-label={`Edit ${member.name}`} onClick={() => setEditing(member.id)}>
                    <Pencil className="h-4 w-4" aria-hidden />
                  </button>
                  <button type="button" disabled={pending} className={ui.iconButton} aria-label={`Remove ${member.name}`}
                    onClick={() => {
                      if (!confirm(`Remove ${member.name} from your team? Leaderboards they are already on keep them.`)) return
                      start(async () => done(await removeTeamMemberAction(scope, member.id)))
                    }}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
        <li>
          <MemberForm
            member={null}
            photoSrc={null}
            busy={pending}
            onSave={(data, reset) => start(async () => {
              const result = await saveTeamMemberAction(scope, null, data)
              done(result)
              if (result.ok) reset()
            })}
          />
        </li>
      </ul>
    </div>
  )
}

/**
 * One member's details, new or existing.
 *
 * The new-agent card resets itself only after its own save succeeds, and
 * holds focus in the name box, so a list of ten people can be typed in one
 * after another without the mouse — and without a slow save wiping out the
 * next name half-way through being typed.
 */
function MemberForm({ member, photoSrc, busy, onSave, onCancel }: {
  member: TeamMemberView | null
  photoSrc: string | null
  busy: boolean
  onSave: (data: FormData, reset: () => void) => void
  onCancel?: () => void
}) {
  const form = useRef<HTMLFormElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const shown = preview ?? photoSrc
  const isNew = member === null

  return (
    <form
      ref={form}
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        onSave(data, () => {
          form.current?.reset()
          setPreview(null)
          nameRef.current?.focus()
        })
      }}
      onKeyDown={(event) => { if (event.key === 'Escape' && onCancel) onCancel() }}
      className={`flex h-full flex-col gap-2.5 rounded-[14px] p-3.5 ${isNew ? 'border border-dashed border-black/20 bg-black/[0.015]' : 'border border-black/25 bg-white ring-4 ring-black/[0.04]'}`}
    >
      <div className="flex items-center gap-3">
        <label className="group relative flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-white text-black/35 ring-1 ring-black/10" title="Choose a photo">
          {shown
            /* eslint-disable-next-line @next/next/no-img-element */
            ? <img src={shown} alt="" className="h-full w-full object-cover" />
            : isNew ? <UserPlus className="h-5 w-5" aria-hidden /> : <span className="text-[17px] font-semibold">{initials(member!.name)}</span>}
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition group-hover:opacity-100">
            <Camera className="h-4 w-4" aria-hidden />
          </span>
          <input name="photo" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
            aria-label={isNew ? 'Photo for the new agent' : `New photo for ${member!.name}`}
            onChange={(e) => {
              const file = e.target.files?.[0]
              setPreview(file ? URL.createObjectURL(file) : null)
            }} />
        </label>
        <div className="min-w-0 flex-1 space-y-1.5">
          <input ref={nameRef} name="name" required defaultValue={member?.name ?? ''} placeholder={isNew ? 'Add an agent — name' : 'Name'}
            autoFocus={!isNew} aria-label="Name"
            className="h-9 w-full rounded-[8px] border border-black/12 bg-white px-2.5 text-[13.5px] font-medium text-black outline-none transition placeholder:font-normal placeholder:text-black/35 focus:border-black/40 focus:ring-4 focus:ring-black/[0.05]" />
          <input name="subtitle" defaultValue={member?.subtitle ?? ''} placeholder="Title or team (optional)" aria-label="Title or team"
            className="h-8 w-full rounded-[8px] border border-black/12 bg-white px-2.5 text-[12.5px] text-black outline-none transition placeholder:text-black/35 focus:border-black/40 focus:ring-4 focus:ring-black/[0.05]" />
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        {onCancel && <button type="button" onClick={onCancel} className={`${ui.ghost} !py-1.5`}>Cancel</button>}
        <button type="submit" disabled={busy} className={`${ui.primary} !h-9 !px-4 !text-[11.5px]`} style={brandFill}>
          {isNew ? <><Plus className="h-3.5 w-3.5" aria-hidden />{busy ? 'Adding…' : 'Add'}</> : busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
