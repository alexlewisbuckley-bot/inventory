import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { coerceTray, MAX_TRAY_IMAGES, TRAY_TOOL } from '@/server/services/tray-ai'
import { yearFromCard } from '@/lib/card-date'

const read = (path: string) => readFileSync(path, 'utf8')
const service = read('src/server/services/tray-ai.ts')
const action = read('src/app/actions/tray.ts')
const screen = read('src/components/inventory/TrayIntake.tsx')
const route = read('src/app/api/intake/tray/route.ts')

const schema = TRAY_TOOL.input_schema as unknown as {
  properties: {
    watches: { items: { properties: Record<string, { description?: string }>; required: string[] } }
    note: unknown
  }
  required: string[]
}

/**
 * A tray of watches, booked in from one photograph.
 *
 * Alex, with a picture of four Rolexes on bubble wrap, each beside its own
 * guarantee card: "I would like to be able to drop an image like this
 * somewhere and the system import them accordingly."
 *
 * That is how a delivery arrives — bagged, laid out, photographed before
 * anything is unpacked — and every reference and serial is already in the
 * one picture.
 */

const watch = (over: Record<string, unknown> = {}) => ({
  position: 'top left', model: '126500LN', serial: 'Q2226SG6', brand: 'Rolex',
  modelName: 'Daytona', cardDate: '05.09.2025', dial: 'White',
  caseMaterial: 'Steel', bracelet: 'Oyster', unreadable: '', ...over,
})

describe('what the photograph is asked for', () => {
  it('is one entry per watch, not one watch', () => {
    // The single-watch reader is told "these pictures are of one watch" and
    // uses several angles of it. This one is told there are several, and a
    // tool returning one could not express the pairing at all.
    expect(schema.properties.watches).toBeDefined()
    expect(TRAY_TOOL.name).toBe('record_watches')
    expect(TRAY_TOOL).toHaveProperty('strict', true)
  })

  it('asks where in the frame each watch was', () => {
    /*
     * The one error this can make that costs more than it saves is pairing
     * a card with the wrong watch — two records that each look right and
     * are both wrong, found out when one is sold. Position is what makes
     * that checkable against the picture at a glance.
     */
    expect(schema.properties.watches.items.required).toContain('position')
    expect(String(schema.properties.watches.items.properties.position.description))
      .toMatch(/how somebody checks the pairing/)
  })

  it('tells it to read the card lying with the watch, not the nearest one', () => {
    expect(service).toMatch(/Pair each watch with the card lying WITH it, not the nearest card/)
  })

  it('takes the date exactly as written and does not try to parse it', () => {
    // "06.04.2026" is the sixth of April or the fourth of June depending on
    // who filled the card in, and the model is in no position to know.
    expect(String(schema.properties.watches.items.properties.cardDate.description))
      .toMatch(/do not work out which part is the month/i)
  })

  it('leaves every field sayable as empty', () => {
    const items = schema.properties.watches.items
    expect([...items.required].sort()).toEqual(Object.keys(items.properties).sort())
  })

  it('thinks harder than the single-watch reader', () => {
    // Pairing is a spatial judgement across a whole frame.
    expect(service).toMatch(/const EFFORT = 'high'/)
  })
})

describe('turning the answer into rows', () => {
  it('keeps one row per watch, in the order read', () => {
    const reading = coerceTray({
      watches: [watch(), watch({ position: 'top right', model: '336933', serial: 'W76H2078' })],
      note: '',
    })!
    expect(reading.watches).toHaveLength(2)
    expect(reading.watches.map((w) => w.serial)).toEqual(['Q2226SG6', 'W76H2078'])
  })

  it('drops an entry with neither a reference nor a serial', () => {
    /*
     * A reflection counted as a watch, or a card nobody could read. Carrying
     * it into the review screen as an empty row is worse than not mentioning
     * it — somebody has to work out what it was before they can delete it.
     */
    const reading = coerceTray({
      watches: [watch(), watch({ model: '', serial: '', position: 'middle' })],
      note: '',
    })!
    expect(reading.watches).toHaveLength(1)
  })

  it('keeps a watch whose card gave only one of the two', () => {
    // Half a card is still a watch somebody can finish by hand.
    expect(coerceTray({ watches: [watch({ serial: '' })], note: '' })!.watches).toHaveLength(1)
    expect(coerceTray({ watches: [watch({ model: '' })], note: '' })!.watches).toHaveLength(1)
  })

  it('carries what could not be read, per watch', () => {
    const reading = coerceTray({
      watches: [watch({ unreadable: 'serial behind a reflection' })], note: 'the tray is cut off at the bottom',
    })!
    expect(reading.watches[0].unreadable).toBe('serial behind a reflection')
    expect(reading.note).toBe('the tray is cut off at the bottom')
  })

  it('refuses a list long enough to be a misread', () => {
    const many = Array.from({ length: 40 }, (_, i) => watch({ serial: `S${i}` }))
    expect(coerceTray({ watches: many, note: '' })!.watches.length).toBeLessThanOrEqual(24)
  })

  it('returns nothing for something that is not an answer', () => {
    expect(coerceTray(null)).toBeNull()
    expect(coerceTray('[]')).toBeNull()
  })
})

describe('the card’s date is the watch’s year, and nothing else', () => {
  it('takes the year from either way of writing it', () => {
    expect(yearFromCard('05.09.2025')).toBe('2025')
    expect(yearFromCard('04/03/2021')).toBe('2021')
    expect(yearFromCard('06.04.2026')).toBe('2026')
  })

  it('says nothing where the card did not', () => {
    expect(yearFromCard(null)).toBe('')
    expect(yearFromCard('')).toBe('')
    expect(yearFromCard('illegible')).toBe('')
  })

  it('never becomes the purchase date', () => {
    /*
     * What is printed after DATE OF PURCHASE is when the FIRST owner bought
     * it from a retailer. On a second-hand watch that is a different fact
     * from when this shop bought it, and writing it into the purchase date
     * would misdate the stock, the ageing report, and every margin worked
     * out from how long a piece was held.
     */
    expect(action).toMatch(/purchaseDate: booking\.purchaseDate/)
    expect(action).not.toMatch(/cardDate/)
    expect(screen).toMatch(/Not the date on the card/)
  })
})

describe('booking the tray in', () => {
  it('goes through the same commit the spreadsheet uses', () => {
    // Brands and suppliers created the same way, stock numbers allocated the
    // same way, movements written the same way, library photographs applied
    // the same way. A second implementation of any of that is a second thing
    // to keep right.
    expect(action).toMatch(/commitImport\(rows, actor\)/)
    expect(action).toMatch(/action: 'CREATE'/)
  })

  it('refuses a tray that has been booked in once already', () => {
    /*
     * A delivery photographed twice is the realistic mistake, and it leaves
     * two of everything with no obvious sign. The serial is the only thing
     * in a tray that identifies one watch, so it is what is checked.
     */
    expect(action).toMatch(/inArray\(watches\.serial, serials\)/)
    expect(action).toMatch(/booked in once already/)
  })

  it('checks again on the server what the screen already refused', () => {
    // The action is reachable without the screen, and the cost of trusting
    // it is stock records nobody can account for.
    for (const guard of [/Choose who these came from/, /Choose where they are/, /nothing to book in/]) {
      expect(action).toMatch(guard)
    }
  })

  it('is for somebody who may import, because that is what it does', () => {
    expect(action).toMatch(/requireCapability\('data:import'\)/)
  })

  it('writes nothing while it is only reading', () => {
    expect(route).not.toMatch(/db\.insert|commitImport|createWatch/)
  })
})

describe('the screen in front of it', () => {
  it('shows nothing until somebody has looked at it', () => {
    expect(screen).toMatch(/Check each against the picture/)
    expect(screen).toMatch(/Book in \{rows\.length\}/)
  })

  it('will not book a row with no reference', () => {
    expect(screen).toMatch(/const missingReference = rows\?\.some\(\(row\) => row\.model\.trim\(\) === ''\)/)
    expect(screen).toMatch(/disabled=\{!ready \|\| missingReference\}/)
  })

  it('lets a row be thrown away', () => {
    // A card with no watch, or a watch already on the book.
    expect(screen).toMatch(/const drop = \(key: string\)/)
  })

  it('reads at a higher resolution than the gallery files at', () => {
    expect(screen).toMatch(/const READ_EDGE = 2400/)
  })

  it('looks at a bounded number of photographs', () => {
    expect(MAX_TRAY_IMAGES).toBeGreaterThanOrEqual(1)
    expect(route).toMatch(/files\.slice\(0, MAX_TRAY_IMAGES\)/)
  })
})
