'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, Check, Sparkles, Wand2 } from 'lucide-react'
import { Button, Chip, useToast } from '@/components/ui'
import { scanGapsAction } from '@/app/actions/gaps'
import { amendWatchAction } from '@/app/actions/watches'
import type { Suggestion } from '@/lib/gap-suggestions'
import { cn } from '@/lib/cn'

/**
 * Proposed answers for the blanks, on the page where the blanks are filled.
 *
 * Every row here is a proposal and nothing more. The Accept button calls
 * `amendWatchAction` — the same action the grid below calls when somebody
 * types into a cell — so an accepted suggestion is validated, version-checked
 * and audited identically to a hand edit, and is attributed to whoever
 * clicked rather than to the machine that proposed it.
 *
 * The evidence is given the same weight as the value, because a suggestion
 * nobody can check is a guess with a button next to it. A row from the book
 * names the stock numbers it copied; a row from Claude gives its reasoning.
 * Both are one glance.
 */

export interface GapScannerProps {
  /** Hidden outright where the reader could not act on what it finds. */
  canEdit: boolean
}

const FIELD_LABEL: Record<Suggestion['field'], string> = {
  modelName: 'Model name',
  caseSizeMm: 'Size',
}

export function GapScanner({ canEdit }: GapScannerProps) {
  const router = useRouter()
  const toast = useToast()
  const [scanning, setScanning] = useState(false)
  const [ran, setRan] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [gaps, setGaps] = useState(0)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [applying, setApplying] = useState<string | null>(null)

  if (!canEdit) return null

  const key = (s: Suggestion) => `${s.watchId}:${s.field}`

  async function scan() {
    setScanning(true)
    try {
      const result = await scanGapsAction()
      setRan(true)
      setNotice(result.notice ?? null)
      setGaps(result.gaps)
      setSuggestions(result.suggestions)
      if (!result.ok) toast.error('The scan could not be run', result.message)
    } finally {
      setScanning(false)
    }
  }

  async function accept(suggestion: Suggestion) {
    setApplying(key(suggestion))
    try {
      const state = await amendWatchAction({
        field: 'content',
        id: suggestion.watchId,
        key: suggestion.field,
        value: suggestion.value,
      })
      if (!state.ok) {
        toast.error(`Stock ${suggestion.stockNo} could not be saved`, state.message)
        return
      }
      // Off the list, because it is no longer a gap. The grid behind this
      // reads from the server, so it needs telling.
      setSuggestions((current) => current.filter((s) => key(s) !== key(suggestion)))
      toast.success(
        `Stock ${suggestion.stockNo} updated`,
        `${FIELD_LABEL[suggestion.field]} set to ${suggestion.value}${suggestion.field === 'caseSizeMm' ? 'mm' : ''}.`,
      )
      router.refresh()
    } finally {
      setApplying(null)
    }
  }

  async function acceptAllFromBook() {
    const fromBook = suggestions.filter((s) => s.source === 'book')
    for (const suggestion of fromBook) await accept(suggestion)
  }

  const bookCount = suggestions.filter((s) => s.source === 'book').length

  return (
    <section className="mb-4 rounded-md border border-border-subtle bg-surface-raised">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Button variant="secondary" onClick={scan} disabled={scanning}>
          <Wand2 className="size-4" aria-hidden />
          {scanning ? 'Looking…' : 'Suggest what is missing'}
        </Button>
        <p className="text-caption text-content-secondary">
          Reads the reference against the rest of the book first, then asks Claude about the ones
          it has never held. Nothing is saved until you accept it.
        </p>
      </div>

      {ran && (
        <div className="border-t border-border-subtle px-4 py-3">
          {notice && (
            <p className="mb-3 text-caption text-content-secondary">
              The book was searched as normal, but Claude was not reached: {notice}.
            </p>
          )}

          {suggestions.length === 0 ? (
            <p className="text-caption text-content-secondary">
              {gaps === 0
                ? 'Nothing is missing — every held watch has a model name and a size.'
                : `${gaps} ${gaps === 1 ? 'blank' : 'blanks'}, and nothing could be proposed for ${gaps === 1 ? 'it' : 'them'} with any confidence. They need filling in by hand below.`}
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-caption text-content-secondary">
                  <span className="font-semibold text-content-primary">{suggestions.length}</span>
                  {' '}of {gaps} {gaps === 1 ? 'blank' : 'blanks'} has a proposal.
                </span>
                {bookCount > 1 && (
                  <Button variant="ghost" size="sm" onClick={acceptAllFromBook} disabled={!!applying}>
                    Accept the {bookCount} from the book
                  </Button>
                )}
              </div>

              <ul className="flex flex-col gap-1.5">
                {suggestions.map((suggestion) => (
                  <li
                    key={key(suggestion)}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border-subtle px-3 py-2"
                  >
                    <span className="font-mono text-caption text-content-secondary">
                      {suggestion.stockNo}
                    </span>
                    <span className="font-mono text-caption text-content-secondary">
                      {suggestion.reference}
                    </span>
                    <Chip tone={suggestion.source === 'book' ? 'neutral' : 'navy'}>
                      {suggestion.source === 'book' ? (
                        <BookOpen className="size-3" aria-hidden />
                      ) : (
                        <Sparkles className="size-3" aria-hidden />
                      )}
                      {suggestion.source === 'book' ? 'From the book' : 'Claude'}
                    </Chip>
                    <span className="text-caption text-content-secondary">
                      {FIELD_LABEL[suggestion.field]} →{' '}
                      <span className="font-semibold text-content-primary">
                        {suggestion.value}
                        {suggestion.field === 'caseSizeMm' ? 'mm' : ''}
                      </span>
                    </span>
                    <span className="min-w-[12rem] flex-1 text-caption text-content-tertiary">
                      {suggestion.evidence}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => accept(suggestion)}
                      disabled={applying === key(suggestion)}
                      className={cn(applying === key(suggestion) && 'opacity-60')}
                    >
                      <Check className="size-3.5" aria-hidden />
                      Accept
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}
