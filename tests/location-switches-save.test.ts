import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const action = readFileSync('src/app/actions/reference.ts', 'utf8')
const validation = readFileSync('src/lib/validation.ts', 'utf8')
const manager = readFileSync('src/components/reference/LocationManager.tsx', 'utf8')
const service = readFileSync('src/server/services/reference-service.ts', 'utf8')

/**
 * A checkbox that saves nothing is worse than no checkbox.
 *
 * It happened three times on this one form. "Sell this location's stock on
 * the website" was on it from migration 0036 and in neither `locationSchema`
 * nor `saveLocationAction`, so unticking it saved nothing. Then `isOnHand`
 * the same way, except worse — the schema default of true filled the absence
 * back in, so every save of any location turned the switch back ON. Alex: "I
 * am unticking DGA but it isn't working."
 *
 * The answer in the end was not a fourth careful read. Alex: "can we make it
 * simple and just have an active - inactive toggle ... there is so many ticks
 * for no reason what so ever. Either they are in Dubai and on our website,
 * trade portals, inventory main view or they aren't." Four boxes asked one
 * question, and the fourth — "Active" — was read nowhere in the application
 * at all, its hint promising something nothing enforced.
 *
 * So there is one box, and the columns are written from it together. What is
 * left here is the guard that would have caught all three: every checkbox on
 * the form must be read by the action, derived from the form rather than
 * listed by somebody who remembered.
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
    expect(names.length).toBeGreaterThan(0)
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
     * save turns the switch back on. That is what happened to `isOnHand`.
     */
    const save = saveLocation()
    for (const name of formCheckboxes()) {
      expect(save, `${name} is read without === 'on', so an untick becomes the default`)
        .toMatch(new RegExp(`formData\\.get\\('${name}'\\) === 'on'`))
    }
  })

  it('asks the one question once', () => {
    // Four boxes for one question is three chances to answer it differently,
    // which is how Hong Kong came to be off the trade list and on the site.
    expect(formCheckboxes()).toEqual(['isOnHand'])
  })

  it('writes every column from that one answer', () => {
    /*
     * The columns stay, so every query that reads them keeps working and the
     * finer grain is a code change away rather than a data migration. What
     * they cannot do any more is disagree.
     */
    const save = saveLocation()
    expect(save).toContain("const active = formData.get('isOnHand') === 'on'")
    for (const column of ['isOnHand', 'publishToStorefront', 'showInTradeCatalogue', 'isActive']) {
      expect(save, `${column} is not written from the one switch`).toContain(`${column}: active,`)
    }
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
    expect(manager).toMatch(/name="isOnHand" label="Active"/)
    // And the three that asked the same question again are gone from it.
    expect(manager).not.toMatch(/<Checkbox\s+name="publishToStorefront"/)
    expect(manager).not.toMatch(/<Checkbox\s+name="showInTradeCatalogue"/)
    expect(manager).not.toMatch(/<Checkbox\s+name="isActive"/)
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
    expect(update.slice(0, 1200)).toMatch(/'publishToStorefront', 'showInTradeCatalogue', 'isOnHand'/)
  })

  it('starts a new transit location off', () => {
    // A watch in a van is not for sale from anywhere, and nobody should have
    // to know to untick a box they were never shown a reason to look at.
    expect(manager).toMatch(/if \(!location\) setActive\(next !== 'TRANSIT'\)/)
  })

  it('shows an existing location what it is actually set to', () => {
    // Suggestion only on create. The stored setting is the authority once it
    // exists, or editing a transit location would keep re-answering a
    // question somebody had already answered.
    expect(manager).toMatch(/if \(!location\) setActive/)
  })
})
