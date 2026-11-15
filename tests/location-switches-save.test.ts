import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const action = readFileSync('src/app/actions/reference.ts', 'utf8')
const validation = readFileSync('src/lib/validation.ts', 'utf8')
const manager = readFileSync('src/components/reference/LocationManager.tsx', 'utf8')
const service = readFileSync('src/server/services/reference-service.ts', 'utf8')

/**
 * A checkbox that saves nothing is worse than no checkbox.
 *
 * "Sell this location's stock on the website" had been on the locations form
 * since migration 0036, with a label, a hint, and a default that changes with
 * the location type. It was in neither `locationSchema` nor
 * `saveLocationAction`, so unticking it saved nothing and the column was only
 * ever writable by the migration that created it.
 *
 * Then it happened a third time. Alex: "I am unticking DGA but it isn't
 * working." `isOnHand` was on the form and in the schema with a default of
 * true, and the action never read it — so the untick left the field absent,
 * the default filled it back in, and `updateLocation` spread it into the
 * patch and wrote `is_on_hand = true`. Not ignored: REVERSED. Saving any
 * location for any reason turned it back on, so correcting Hong Kong's
 * address would quietly have put it back on the website.
 *
 * This file existed and did not catch it, because it named the two fields it
 * knew about. So the test that matters now derives the list from the form:
 * every checkbox on it must be read by the action, whatever it is called and
 * whenever it was added.
 */
/** Every checkbox the locations form posts, by the name it posts under. */
function formCheckboxes(): string[] {
  return [...manager.matchAll(/<Checkbox\s+name="(\w+)"/g)].map((match) => match[1])
}

/** Just `saveLocationAction`, so a read in the supplier action next door does not count. */
function saveLocation(): string {
  return action.slice(
    action.indexOf('export async function saveLocationAction'),
    action.indexOf('export async function deleteLocationAction'),
  )
}

describe('the switches on a location actually save', () => {
  it('reads every checkbox the form posts, not the ones we remembered', () => {
    /*
     * The structural version of this test, which is the only version that
     * would have caught the third occurrence. A checkbox added to the form
     * next year is covered without anybody thinking to come back here.
     */
    const names = formCheckboxes()
    expect(names.length).toBeGreaterThanOrEqual(4)
    expect(names).toContain('isOnHand')
    const save = saveLocation()
    for (const name of names) {
      expect(save, `${name} is a checkbox on the form that saveLocationAction never reads`)
        .toContain(`formData.get('${name}')`)
    }
  })

  it('spells the absence out as false for every one of them', () => {
    /*
     * An unticked checkbox is absent from the payload, not present and
     * false. Left to the schema, `undefined` takes the default and the
     * untick is not ignored but reversed — the default is `true`, so the
     * save turns the switch back on.
     */
    const save = saveLocation()
    for (const name of formCheckboxes()) {
      expect(save, `${name} is read without === 'on', so an untick becomes the default`)
        .toMatch(new RegExp(`${name}: formData\\.get\\('${name}'\\) === 'on'`))
    }
  })

  it('is read off the form', () => {
    expect(action).toMatch(/publishToStorefront: formData\.get\('publishToStorefront'\) === 'on'/)
    expect(action).toMatch(/showInTradeCatalogue: formData\.get\('showInTradeCatalogue'\) === 'on'/)
    expect(action).toMatch(/isOnHand: formData\.get\('isOnHand'\) === 'on'/)
  })

  it('survives the schema instead of being stripped by it', () => {
    const schema = validation.slice(validation.indexOf('export const locationSchema'))
    const body = schema.slice(0, schema.indexOf('})'))
    expect(body).toMatch(/publishToStorefront: z\.coerce\.boolean\(\)/)
    expect(body).toMatch(/showInTradeCatalogue: z\.coerce\.boolean\(\)/)
    expect(body).toMatch(/isOnHand: z\.coerce\.boolean\(\)/)
  })

  it('does not let the schema default turn an untick into a no-op', () => {
    /*
     * An unticked checkbox is absent from the payload, not present and
     * false. Left to the schema, `undefined` takes the default of true and
     * every untick saves nothing — which is the original fault wearing a
     * different hat. The action spells out the absence as false.
     */
    expect(action).not.toMatch(/publishToStorefront: formData\.get\('publishToStorefront'\),/)
    expect(action).not.toMatch(/showInTradeCatalogue: formData\.get\('showInTradeCatalogue'\),/)
  })

  it('is on the form for somebody to tick', () => {
    expect(manager).toMatch(/name="publishToStorefront"/)
    expect(manager).toMatch(/name="showInTradeCatalogue"/)
    expect(manager).toMatch(/name="isOnHand"/)
  })

  it('is read back out, or the form would open on a stale value', () => {
    expect(service).toMatch(/showInTradeCatalogue: locations\.showInTradeCatalogue/)
    expect(service).toMatch(/publishToStorefront: locations\.publishToStorefront/)
    expect(service).toMatch(/isOnHand: locations\.isOnHand/)
  })

  it('is recorded in the audit like any other change', () => {
    // Who may be shown the stock in a place is exactly the sort of change
    // somebody asks about afterwards.
    const update = service.slice(service.indexOf('export async function updateLocation'))
    expect(update.slice(0, 1200)).toMatch(/'publishToStorefront', 'showInTradeCatalogue'/)
  })

  it('suggests both off for a new transit location', () => {
    // The one case where the two questions have the same answer, and
    // nobody should have to know to untick anything.
    expect(manager).toMatch(/setPublishes\(next !== 'TRANSIT'\)/)
    expect(manager).toMatch(/setOnTradeList\(next !== 'TRANSIT'\)/)
  })

  it('shows an existing location what it is actually set to', () => {
    // Suggestion only on create. The stored setting is the authority once
    // it exists, or editing a transit location would keep re-answering a
    // question somebody had already answered.
    expect(manager).toMatch(/if \(!location\) \{\n\s+setPublishes/)
  })
})
