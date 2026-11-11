import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { coerceReading, MAX_IMAGES, WATCH_TOOL } from '@/server/services/watch-ai'
import { IMAGE_KINDS } from '@/lib/enums'

const read = (path: string) => readFileSync(path, 'utf8')
const service = read('src/server/services/watch-ai.ts')
const route = read('src/app/api/intake/read/route.ts')
const form = read('src/components/inventory/WatchForm.tsx')
const zone = read('src/components/inventory/ReadFromPhotos.tsx')

const schema = WATCH_TOOL.input_schema as unknown as {
  properties: Record<string, { type?: unknown; description?: string; items?: { enum: string[] } }>
  required: string[]
  additionalProperties: boolean
}

/**
 * Starting a stock record from photographs of the watch and its card.
 *
 * Alex: "we really need to be able to add just a picture of the watch and
 * the card that has the reference number and the serial number, and then we
 * can actually start adding the other details."
 *
 * So the photographs answer what they can see — the reference, the serial,
 * the dial, the metal — and nothing else. The cost and the supplier are not
 * in any photograph and are still typed.
 */

describe('the shape the answer has to take', () => {
  it('stays under the strict-mode ceiling on union-typed parameters', () => {
    /*
     * The one failure that cannot be caught by reading the code.
     *
     * The invoice reader hit it: declaring every field ["string", "null"]
     * came to eighteen union-typed parameters against a ceiling of sixteen,
     * and the API answered 400 to every request — which the caller then
     * reported as the model being unavailable. Text here says "" for "not
     * shown" so only the two numbers are unions, and this is what keeps it
     * that way as fields are added.
     */
    const unions = Object.values(schema.properties).filter((spec) => Array.isArray(spec.type))
    expect(unions.length).toBeLessThanOrEqual(16)
    expect(unions.length).toBe(2)
  })

  it('requires every property, so "not shown" is a value and not an omission', () => {
    // A field the model may leave out is a field it will leave out, and an
    // absent key and an unreadable serial are then the same thing.
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort())
    expect(schema.additionalProperties).toBe(false)
    expect(WATCH_TOOL).toHaveProperty('strict', true)
  })

  it('asks for the reference and the serial as separate things', () => {
    // They sit side by side on a warranty card and are the one pair that
    // must not be swapped: one identifies the model, one identifies this
    // watch.
    expect(schema.properties.model).toBeDefined()
    expect(schema.properties.serial).toBeDefined()
    expect(String(schema.properties.model.description))
      .toMatch(/NOT the model name and NOT the serial/)
  })

  it('offers only image kinds the gallery already files by', () => {
    expect(schema.properties.imageKinds.items?.enum).toEqual([...IMAGE_KINDS])
  })
})

describe('turning an answer into a reading', () => {
  const answer = (over: Record<string, unknown> = {}) => coerceReading({
    model: '116610LN', serial: 'R4T9K2M1', brand: 'Rolex', modelName: 'Submariner Date',
    year: 2019, dial: 'Black', caseMaterial: 'Steel', bracelet: 'Oyster',
    caseSizeMm: 40, unreadable: '', imageKinds: ['WATCH', 'CARD'], ...over,
  }, 2)

  it('reads the two that matter', () => {
    const reading = answer()!
    expect(reading.model).toBe('116610LN')
    expect(reading.serial).toBe('R4T9K2M1')
  })

  it('turns "not shown" back into nothing', () => {
    // The schema says "" rather than null to stay under the union ceiling;
    // this is where that encoding is undone, so the form sees a blank.
    const reading = answer({ serial: '', dial: '   ', unreadable: '' })!
    expect(reading.serial).toBeNull()
    expect(reading.dial).toBeNull()
    expect(reading.unreadable).toBeNull()
  })

  it('refuses a year that cannot be a year', () => {
    /*
     * A misread date on a card is the likeliest wrong number here — a
     * guarantee stamp reading 2O19 or a four-digit figure that was part of
     * the reference. Out of range is dropped rather than written into the
     * form, because a wrong year looks exactly like a right one.
     */
    expect(answer({ year: 1823 })!.year).toBeNull()
    expect(answer({ year: 9999 })!.year).toBeNull()
    expect(answer({ year: new Date().getFullYear() + 5 })!.year).toBeNull()
    expect(answer({ year: 2019.4 })!.year).toBe(2019)
  })

  it('refuses a case size no wristwatch has', () => {
    expect(answer({ caseSizeMm: 400 })!.caseSizeMm).toBeNull()
    expect(answer({ caseSizeMm: 0 })!.caseSizeMm).toBeNull()
    expect(answer({ caseSizeMm: 41 })!.caseSizeMm).toBe(41)
  })

  it('gives every image a kind, however short the answer', () => {
    // The kinds are read by position when the photographs are filed, so a
    // short or stray answer must not shift the rest along.
    expect(coerceReading({ imageKinds: ['CARD'] }, 3)!.imageKinds).toEqual(['CARD', 'WATCH', 'WATCH'])
    expect(coerceReading({ imageKinds: ['NONSENSE', 'CARD'] }, 2)!.imageKinds).toEqual(['WATCH', 'CARD'])
    expect(coerceReading({}, 2)!.imageKinds).toEqual(['WATCH', 'WATCH'])
  })

  it('returns nothing at all for something that is not an answer', () => {
    expect(coerceReading(null, 1)).toBeNull()
    expect(coerceReading('{}', 1)).toBeNull()
  })
})

describe('what it is allowed to do', () => {
  it('writes nothing', () => {
    // It reads files and answers. The stock record is created afterwards,
    // by the form, once somebody has looked at what it said.
    expect(route).not.toMatch(/db\.insert|db\.update|createWatch/)
  })

  it('matches a brand against the shop\u2019s own list rather than creating one', () => {
    expect(route).toMatch(/db\.select\(\{ id: brands\.id \}\)[\s\S]*eq\(brands\.slug, slug\)/)
    expect(route).not.toMatch(/insert\(brands\)/)
  })

  it('is behind the capability for the thing it serves, and a tighter limit', () => {
    // It writes nothing but it spends money, so the ceiling is its own.
    expect(route).toMatch(/requireCapability\('watch:create'\)/)
    expect(route).toMatch(/rateLimit\(\{ key: `read:\$\{actor\.id\}`, \.\.\.LIMITS\.read \}\)/)
  })

  it('sends bytes as bytes', () => {
    // A server action would serialise the payload as JSON and base64 the
    // photographs, which is a third more of them over the wire.
    expect(route).toMatch(/export async function POST/)
    expect(zone).toMatch(/fetch\('\/api\/intake\/read', \{ method: 'POST', body \}\)/)
  })

  it('looks at a bounded number of photographs', () => {
    expect(MAX_IMAGES).toBeGreaterThanOrEqual(2)
    expect(route).toMatch(/files\.slice\(0, MAX_IMAGES\)/)
    expect(service).toMatch(/\.slice\(0, MAX_IMAGES\)/)
  })
})

describe('the reading reaching the form', () => {
  it('fills blanks and never overwrites typing', () => {
    /*
     * Somebody who typed the reference while the reading was in flight has
     * told us something the photograph has not. Having it replaced a second
     * later by a machine is what makes people stop trusting the feature.
     */
    expect(form).toMatch(/if \(String\(current\[key\] \?\? ''\)\.trim\(\) !== ''\) return/)
  })

  it('opens the section the reading mostly lands in', () => {
    // Six boxes filled below the fold, where nobody can see them, is worse
    // than none.
    expect(form).toMatch(/setShowOptional\(true\)/)
  })

  it('offers it only where there is a blank form to fill', () => {
    expect(form).toMatch(/mode === 'create' && \(\s*<ReadFromPhotos/)
  })

  it('says nothing at all when no key is configured', () => {
    // Not an error and not a broken button: the form simply opens as it
    // always did.
    expect(zone).toMatch(/if \(!enabled\) return null/)
    // Awaited now: the key can come from the database as well as the
    // environment, so asking whether one exists is a read.
    expect(service).toMatch(/if \(!await watchAiConfigured\(\)\) return \{ reading: null, error: null \}/)
  })
})

describe('the photographs themselves', () => {
  it('are read larger than they are filed', () => {
    // A serial is a couple of hundred pixels wide in the frame; at the
    // gallery's 1600 the difference between an 8 and a B is a few pixels.
    expect(zone).toMatch(/const READ_EDGE = 2000/)
    expect(zone).toMatch(/downscaleImage\(image, \{ maxEdge: READ_EDGE, quality: 0\.9 \}\)/)
    // Filed at the gallery's own size, with no override.
    expect(form).toMatch(/downscaleImage\(photo\.file\)/)
  })

  it('are kept and filed against the watch once it exists', () => {
    // Making somebody find the same two files again, on the gallery, would
    // be the whole saving given back.
    expect(form).toMatch(/state\.id \? await attachPhotos\(state\.id, photos\) : null/)
    expect(form).toMatch(/body\.set\('kind', photo\.kind\)/)
  })

  it('does not unmake the watch when an upload fails', () => {
    // The watch is in stock by then. That is a fact, and a flaky upload
    // must not look like a failed form.
    const body = form.slice(form.indexOf('async function attachPhotos'))
    expect(body).toMatch(/catch \{\s*failed \+= 1/)
    expect(form).toMatch(/could not be attached — add them from the record/)
  })
})
