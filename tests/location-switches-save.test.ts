import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const action = readFileSync('src/app/actions/reference.ts', 'utf8')
const validation = readFileSync('src/lib/validation.ts', 'utf8')
const manager = readFileSync('src/components/reference/LocationManager.tsx', 'utf8')
const service = readFileSync('src/server/services/reference-service.ts', 'utf8')

/**
 * A checkbox that saves nothing is worse than no checkbox.
 *
 * "Sell this location's stock on the website" had been on the locations
 * form since migration 0036, with a label, a hint, and a default that
 * changes with the location type. It was in neither `locationSchema` nor
 * `saveLocationAction`, so unticking it saved nothing and the column was
 * only ever writable by the migration that created it. Nobody noticed
 * because transit — the case it was built for — was already set by that
 * migration, and nobody had yet had a reason to switch a different place
 * off by hand.
 *
 * That reason is now here: Hong Kong has to come off the trade list, and
 * off it from the screen rather than by a migration every time the answer
 * changes. So both switches are plumbed, and this is what keeps them that
 * way — the fault was invisible from the UI and invisible to the type
 * checker, which is exactly the kind that comes back.
 */
describe('the switches on a location actually save', () => {
  it('is read off the form', () => {
    expect(action).toMatch(/publishToStorefront: formData\.get\('publishToStorefront'\) === 'on'/)
    expect(action).toMatch(/showInTradeCatalogue: formData\.get\('showInTradeCatalogue'\) === 'on'/)
  })

  it('survives the schema instead of being stripped by it', () => {
    const schema = validation.slice(validation.indexOf('export const locationSchema'))
    const body = schema.slice(0, schema.indexOf('})'))
    expect(body).toMatch(/publishToStorefront: z\.coerce\.boolean\(\)/)
    expect(body).toMatch(/showInTradeCatalogue: z\.coerce\.boolean\(\)/)
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
  })

  it('is read back out, or the form would open on a stale value', () => {
    expect(service).toMatch(/showInTradeCatalogue: locations\.showInTradeCatalogue/)
    expect(service).toMatch(/publishToStorefront: locations\.publishToStorefront/)
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
