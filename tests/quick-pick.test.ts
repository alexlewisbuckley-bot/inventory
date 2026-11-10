import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BOX_PAPERS, CONDITIONS } from '@/lib/enums'
import { CONTENT_FIELDS } from '@/lib/validation'
import { ROLE_CAPABILITIES, can } from '@/lib/permissions'

const read = (path: string) => readFileSync(path, 'utf8')
const pick = read('src/components/inventory/QuickPick.tsx')
const drawer = read('src/components/inventory/WatchDrawerClient.tsx')
const record = read('src/app/(app)/inventory/[id]/page.tsx')
const actions = read('src/app/actions/watches.ts')

/**
 * Condition and box-and-papers, answered where they are read.
 *
 * Alex, on a panel showing both as "Not recorded": "Allow quick updates
 * drop down here."
 *
 * Both are routinely unknown when a watch is booked in and known a minute
 * later with the piece in hand. The only way to answer them was the full
 * edit form, which nobody opens to set one word — which is why records sit
 * unanswered.
 */

describe('the control', () => {
  it('saves through the same action the content grid already uses', () => {
    // Not a second way of writing the field: same action, same validation,
    // same audit entry.
    expect(pick).toMatch(/amendWatchAction\(\{ field: 'content', id: watchId, key: field, value: next \}\)/)
  })

  it('is offered only for the two closed lists', () => {
    /*
     * A serial is typed and wants validation and a save you can abandon; a
     * supplier is a purchase fact, deliberately outside the quick-edit path.
     * The type says so, so a third field cannot be added here by accident.
     */
    expect(pick).toMatch(/field: Extract<ContentField, 'condition' \| 'boxPapers'>/)
  })

  it('puts the old value back when the server refuses', () => {
    // The select has already moved by then — it moved optimistically so the
    // answer is on screen while the server is told. A refusal that left it
    // showing the new value would be a lie about what is recorded.
    const body = pick.slice(pick.indexOf('const commit'))
    expect(body.slice(0, body.indexOf('router.refresh'))).toMatch(/setShown\(value\)[\s\S]*toast\.error/)
  })

  it('shows plain text to a reader who cannot amend', () => {
    expect(pick).toMatch(/if \(!canEdit\) return <span[^>]*>\{text\}<\/span>/)
  })
})

describe('who is shown it', () => {
  it('asks for the capability the action enforces', () => {
    /*
     * The two have to be the same string. A control drawn for a role the
     * action rejects is a dropdown that always fails, which is worse than
     * no dropdown — and watch:amend is narrower than the watch:update that
     * governs the Edit button beside it.
     */
    expect(actions).toMatch(/export async function amendWatchAction[\s\S]*?requireCapability\('watch:amend'\)/)
    for (const [name, source] of [['drawer', drawer], ['record', record]] as const) {
      // Only the control's own canEdit — the Edit button and the image
      // gallery beside it answer to watch:update, which is a wider door.
      const blocks = source.match(/<QuickPick[\s\S]*?\/>/g) ?? []
      expect(blocks.length, name).toBe(2)
      for (const block of blocks) expect(block, name).toMatch(/canEdit=\{[^}]*'watch:amend'[^}]*\}/)
    }
  })

  it('is a capability some role actually holds', () => {
    // A guard nobody passes is a feature nobody has.
    const roles = Object.keys(ROLE_CAPABILITIES) as (keyof typeof ROLE_CAPABILITIES)[]
    expect(roles.filter((role) => can(role, 'watch:amend'))).not.toEqual([])
  })
})

describe('the fields it is wired to', () => {
  it('appears on both the drawer and the full record', () => {
    // One fact shown two ways is how somebody learns a panel is read-only.
    for (const [name, source] of [['drawer', drawer], ['record', record]] as const) {
      expect(source, name).toMatch(/field="condition"/)
      expect(source, name).toMatch(/field="boxPapers"/)
    }
  })

  it('takes its choices from the enums, not a list typed beside it', () => {
    // So a new condition reaches both panels by being added to the enum.
    for (const [name, source] of [['drawer', drawer], ['record', record]] as const) {
      expect(source, name).toMatch(/CONDITIONS\.map\(\(value\) => \(\{ value, label: CONDITION_LABELS\[value\] \}\)\)/)
      expect(source, name).toMatch(/BOX_PAPERS\.map\(\(value\) => \(\{ value, label: BOX_PAPERS_LABELS\[value\] \}\)\)/)
    }
  })

  it('offers "Not recorded" as a choice, because it is one', () => {
    // Going back to unknown is a real answer — the enum keeps a value for
    // it — so it belongs on the list rather than being a state you can only
    // leave.
    expect(CONDITIONS[0]).toBe('UNKNOWN')
    expect(BOX_PAPERS[0]).toBe('UNKNOWN')
  })

  it('leaves serial and supplier as they were', () => {
    expect(drawer).toMatch(/<Fact label="Serial"/)
    expect(drawer).toMatch(/<Fact label="Supplier"/)
    // Supplier could not be quick-edited even if somebody wired it up: it
    // is deliberately not a content field.
    expect(CONTENT_FIELDS).not.toContain('supplierId')
    expect(CONTENT_FIELDS).toContain('condition')
    expect(CONTENT_FIELDS).toContain('boxPapers')
  })
})
