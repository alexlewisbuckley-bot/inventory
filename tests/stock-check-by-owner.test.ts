import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

/**
 * The same file with its prose taken out.
 *
 * The negative assertions below need it. These files explain at length what
 * they deliberately do *not* do — there is no third scope state, the owner is
 * not snapshotted — so a test that greps the raw text matches the very comment
 * promising the absence, and fails on a file that is correct.
 */
const codeOf = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const service = read('src/server/services/stock-check-service.ts')

/**
 * One function's body, sliced to the next export rather than to a character
 * count. The count version passed until the clash rule grew its reasoning
 * above the line being asserted on, and then failed on correct code.
 */
const bodyOf = (source: string, name: string) => {
  const from = source.indexOf(`export async function ${name}`)
  const rest = source.slice(from + 1)
  const to = rest.indexOf('\nexport ')
  return to === -1 ? rest : rest.slice(0, to)
}
const startFn = bodyOf(service, 'startStockCheck')
const list = read('src/components/stock/StockCheckList.tsx')
const runner = read('src/components/stock/StockCheckRunner.tsx')
const migration = read('src/server/db/migrations/0056_count_one_owners_stock.sql')

/**
 * Counting one owner's watches at a time.
 *
 * Alex: "Add owner filtering to stock checks so we can check as we store the
 * watches." The stock is put away by whose it is, so that is how it has to be
 * countable — a safe holding three owners' pieces being three lists somebody
 * can finish rather than one they cannot.
 *
 * Run against a real database and a real browser: two owners counted in one
 * safe at the same time, every overlapping scope refused by name, the owner
 * on each line of a mixed list and on none of a single-owner one, and the
 * unowned warning following the location as it changes. What is kept here is
 * everything provable without either.
 */

describe('what a check covers', () => {
  it('can be narrowed to one owner', () => {
    const scope = service.slice(service.indexOf('export interface StockCheckScope'))
    expect(scope.slice(0, scope.indexOf('}'))).toMatch(/ownerId\?: string \| null/)
    expect(service).toMatch(/ownerId \? eq\(watches\.ownerId, ownerId\) : undefined/)
  })

  it('still counts the stock nobody owns when it is not narrowed', () => {
    /*
     * The `undefined` above is what does it: Drizzle drops it from the
     * predicate, so an every-owner check has no owner clause at all rather
     * than one that quietly excludes a null.
     */
    expect(service).not.toMatch(/isNull\(watches\.ownerId\)[\s\S]{0,80}expected/)
  })

  it('narrows by owner and location independently', () => {
    // Different questions — where it sits, whose it is — and a watch moves
    // between vaults without changing hands.
    expect(startFn).toMatch(/scope\.locationId \? eq\(watches\.locationId, scope\.locationId\) : undefined/)
    expect(startFn).toMatch(/ownerId \? eq\(watches\.ownerId, ownerId\) : undefined/)
  })

  it('has no third state for "only the unowned"', () => {
    /*
     * It would store as a null owner_id exactly as "every owner" does. Two
     * different scopes that are one row in the database is a distinction
     * nothing downstream could make, so the gap is reported instead.
     */
    expect(codeOf(service)).not.toMatch(/NO_OWNER|UNOWNED_ONLY|'__none__'/)
    expect(service).toMatch(/export async function unownedStockCount/)
  })
})

describe('two checks that would count one watch twice', () => {
  it('are refused on the scopes overlapping, not on the location matching', () => {
    /*
     * The old rule was "the same location", right while that was the only
     * thing a check could be narrowed by. With an owner as well it is both
     * too strict — Edward's shelf and Marcus's shelf are two people doing
     * different work in one room — and too loose, because counting the whole
     * room at the same time as counting Edward's part of it is the original
     * fault it was written to stop.
     */
    expect(service).toMatch(/const overlapping = \(column: AnyPgColumn, value: string \| null\) =>/)
    expect(service).toMatch(/\$\{column\} IS NULL OR \$\{column\} = \$\{value\}/)
    const clash = startFn.slice(0, startFn.indexOf('const expected'))
    expect(clash).toMatch(/overlapping\(stockChecks\.locationId/)
    expect(clash).toMatch(/overlapping\(stockChecks\.ownerId/)
    // The old exact-match test must be gone, or it would still refuse the
    // two-owners-one-safe case this feature exists for.
    expect(codeOf(clash)).not.toMatch(/eq\(stockChecks\.locationId, scope\.locationId\)/)
  })

  it('name the check that is in the way, and say it only overlaps', () => {
    // "The same stock" would be a lie about a wider or narrower scope.
    expect(service).toMatch(/is still open and covers some of the same stock/)
  })

  it('treat a null on either side as covering everything', () => {
    expect(service).toMatch(/value === null\s*\n?\s*\? sql`true`/)
  })
})

describe('what the check is called, and what it says it covered', () => {
  it('carries the owner in its own name', () => {
    // The owner is part of what a check was, so it belongs in the name it
    // will be referred to by for as long as the record exists.
    expect(service).toMatch(/\[locationName \?\? 'All stock', ownerName\]\.filter\(Boolean\)\.join\(' · '\)/)
  })

  it('names both halves of an empty scope', () => {
    // "There is no stock to count", against a screen where two things were
    // just picked, does not say which of them was wrong.
    expect(service).toMatch(/locationName \? `at \$\{locationName\}` : null/)
    expect(service).toMatch(/ownerName \? `owned by \$\{ownerName\}` : null/)
  })

  it('is read back with the owner on the list and the detail', () => {
    expect(service.match(/ownerName: owners\.name/g)?.length).toBe(3)
    expect(service.match(/leftJoin\(owners, eq\(owners\.id, stockChecks\.ownerId\)\)/g)?.length).toBe(2)
  })
})

describe('the owner on a line', () => {
  it('is the current one, not one frozen at snapshot', () => {
    /*
     * Unlike the expected location, which is frozen because the count is
     * looking for the watch *there* and a later move must not rewrite what
     * was being looked for. Ownership is not where to look, it is a label on
     * the thing in your hand, and the useful answer is the current one.
     */
    expect(service).toMatch(/leftJoin\(owners, eq\(owners\.id, watches\.ownerId\)\)/)
    expect(codeOf(service)).not.toMatch(/expectedOwnerId|stockCheckLines\.ownerId/)
  })

  it('is shown only where the list holds more than one', () => {
    // On a check already narrowed to one owner it is the same word on every
    // row, which is noise in the one place somebody is scanning at speed.
    expect(runner).toMatch(/const mixedOwners = new Set\(lines\.map\(\(line\) => line\.ownerName\)\)\.size > 1/)
    expect(runner).toMatch(/\{mixedOwners && line\.ownerName/)
  })

  it('counts "nobody" as an owner for that purpose', () => {
    // A name against a blank is exactly the difference worth seeing, so the
    // set is built off the names as they are rather than the non-null ones.
    expect(runner).not.toMatch(/lines\.filter\(\(line\) => line\.ownerName\)/)
  })
})

describe('the stock nobody owns', () => {
  it('is counted per location, because that is what is being asked', () => {
    // A figure for the whole business tells somebody standing in front of
    // one safe nothing they can act on.
    const fn = bodyOf(service, 'unownedStockCount')
    expect(fn).toMatch(/\.groupBy\(watches\.locationId\)/)
    expect(fn).toMatch(/isNull\(watches\.ownerId\)/)
    expect(fn).toMatch(/inArray\(watches\.status, \[\.\.\.ACTIVE_STATUSES\]\)/)
  })

  it('is warned about only when the choice would leave it out', () => {
    /*
     * Narrowing to an owner means a watch with nobody's name against it is
     * on no list at all — in the safe, on no count, and nobody the wiser.
     * An every-owner check still reaches it, which is why this is a warning
     * about the choice rather than a fourth option in the menu.
     */
    expect(list).toMatch(/\{ownerId && nameless > 0 && \(/)
    expect(list).toMatch(/no owner recorded/)
    expect(list).toMatch(/Only an\s*\n?\s*every-owner check counts/)
  })

  it('follows the place being counted', () => {
    expect(list).toMatch(/unowned\.find\(\(row\) => row\.locationId === locationId\)\?\.count \?\? 0/)
    expect(list).toMatch(/unowned\.reduce\(\(sum, row\) => sum \+ row\.count, 0\)/)
  })
})

describe('the picker', () => {
  it('defaults to every owner', () => {
    // Narrowing is the exception, and a default that excludes things is how
    // stock stops being counted.
    expect(list).toMatch(/useState\(''\)[\s\S]{0,200}setNotes/)
    expect(list).toMatch(/\{ value: '', label: 'Every owner' \}/)
  })

  it('is not shown when there is nothing to choose between', () => {
    // One owner is a fact about the business, not a filter, and a select
    // with a single option is furniture in front of the button.
    expect(list).toMatch(/\{owners\.length > 1 && \(/)
  })

  it('resets when a check is opened, so the next one starts unnarrowed', () => {
    expect(list).toMatch(/setOwnerId\(''\)/)
  })
})

describe('the migration', () => {
  it('adds the column without backfilling it', () => {
    // Every check taken so far did cover every owner, so null is not a gap
    // in those rows, it is the truth about them.
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS owner_id text REFERENCES owners \(id\)/)
    expect(migration).not.toMatch(/UPDATE stock_checks/)
  })

  it('indexes it, because there is now one check per owner per count', () => {
    expect(migration).toMatch(/CREATE INDEX IF NOT EXISTS stock_checks_owner_idx ON stock_checks \(owner_id\)/)
  })
})
