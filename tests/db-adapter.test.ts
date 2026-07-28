import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

// Vite rewrites bare `node:sqlite` imports and fails to resolve them, so the
// builtin is loaded through createRequire to exercise the real driver.
const nodeRequire = createRequire(import.meta.url)
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite')

/**
 * Regression guard for the sqlite-proxy adapter.
 *
 * Drizzle's sqlite-proxy driver maps result columns positionally. node:sqlite
 * returns rows as objects by default, and a join selecting the same column
 * name from two tables collapses them into one key — dropping columns and
 * misaligning every value after the collision. The adapter must therefore use
 * `setReturnArrays(true)`.
 */
describe('sqlite-proxy row shape', () => {
  function fixture() {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE a (id TEXT, name TEXT); CREATE TABLE b (id TEXT, a_id TEXT, name TEXT)')
    db.prepare('INSERT INTO a VALUES (?, ?)').run('a1', 'Alpha')
    db.prepare('INSERT INTO b VALUES (?, ?, ?)').run('b1', 'a1', 'Beta')
    return db
  }
  const JOIN = 'SELECT a.id, a.name, b.id, b.a_id, b.name FROM a JOIN b ON b.a_id = a.id'

  it('demonstrates why object rows are unusable for joins', () => {
    const row = fixture().prepare(JOIN).all()[0] as object
    // Five columns requested, three survive — this is the bug being guarded.
    expect(Object.values(row)).toHaveLength(3)
  })

  it('returns every column in order with setReturnArrays', () => {
    const stmt = fixture().prepare(JOIN)
    stmt.setReturnArrays(true)
    const rows = stmt.all() as unknown as unknown[][]
    expect(rows[0]).toEqual(['a1', 'Alpha', 'b1', 'a1', 'Beta'])
    expect(rows[0]).toHaveLength(5)
  })

  it('keeps single-table selects working', () => {
    const stmt = fixture().prepare('SELECT id, name FROM a')
    stmt.setReturnArrays(true)
    expect((stmt.all() as unknown as unknown[][])[0]).toEqual(['a1', 'Alpha'])
  })
})
