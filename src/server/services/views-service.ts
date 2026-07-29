import { and, asc, eq, isNull, or, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { savedViews } from '../db/schema'
import { newId } from '@/lib/ids'
import { NotFoundError, ValidationError } from '@/lib/errors'
import type { SavedViewObject } from '@/lib/enums'
import type { SessionUser } from '../auth/session'

/**
 * Views somebody made.
 *
 * V1 shipped six saved views for stock, hard-coded. They were the right six
 * for whoever wrote them, and there was no seventh — so the queries people
 * actually run every morning stayed as three dropdown interactions rebuilt
 * from memory, several times a day, for the life of the product.
 *
 * A view is a name and a query string, and that is the whole design. The query
 * string already carries filters, sort, search and column choices, and it is
 * already the representation you can paste into a message. Storing a
 * structured copy beside it would be storing the same thing twice and inviting
 * the two to disagree the first time the grammar changed.
 */

export interface SavedViewRow {
  id: string
  name: string
  query: string
  shared: boolean
  mine: boolean
  sortOrder: number
}

const MAX_QUERY_LENGTH = 2000
const MAX_VIEWS_PER_OBJECT = 40

/** Mine, plus anything a colleague shared. */
export async function listViews(
  object: SavedViewObject,
  userId: string,
): Promise<SavedViewRow[]> {
  const rows = await db.select({
    id: savedViews.id,
    name: savedViews.name,
    query: savedViews.query,
    shared: savedViews.shared,
    userId: savedViews.userId,
    sortOrder: savedViews.sortOrder,
  })
    .from(savedViews)
    .where(and(
      isNull(savedViews.deletedAt),
      eq(savedViews.object, object),
      or(eq(savedViews.userId, userId), eq(savedViews.shared, true)),
    ))
    .orderBy(asc(savedViews.sortOrder), asc(savedViews.name))

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    query: row.query,
    shared: row.shared,
    mine: row.userId === userId,
    sortOrder: row.sortOrder,
  }))
}

export async function createView(input: {
  object: SavedViewObject
  name: string
  query: string
  shared?: boolean
}, actor: SessionUser): Promise<string> {
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (!name) throw new ValidationError('Give the view a name.', { name: 'Required.' })
  if (name.length > 60) throw new ValidationError('That name is too long to fit on a chip.', { name: 'Keep it under 60 characters.' })

  // Stored without the leading '?', and capped. A query string long enough to
  // exceed this is somebody using a view as a database, and the row would not
  // survive being put back in a URL anyway.
  const query = input.query.replace(/^\?/, '').slice(0, MAX_QUERY_LENGTH)

  const [{ value: existing }] = await db
    .select({ value: sql<number>`count(*)` })
    .from(savedViews)
    .where(and(
      isNull(savedViews.deletedAt),
      eq(savedViews.object, input.object),
      eq(savedViews.userId, actor.id),
    ))
  if (Number(existing) >= MAX_VIEWS_PER_OBJECT) {
    throw new ValidationError(
      `You already have ${MAX_VIEWS_PER_OBJECT} views on this list. Delete one before adding another.`,
    )
  }

  const id = newId('vew')
  try {
    await db.insert(savedViews).values({
      id,
      userId: actor.id,
      object: input.object,
      name,
      query,
      shared: input.shared ?? false,
      sortOrder: Number(existing),
    })
  } catch (error) {
    // The unique index is case-insensitive, so "Ageing" and "ageing" collide —
    // which is intended. Two views a keystroke apart is a distinction nobody
    // means and everybody trips over.
    if (String((error as Error).message).includes('saved_views_name_idx')) {
      throw new ValidationError('You already have a view with that name.', { name: 'Already used.' })
    }
    throw error
  }
  return id
}

export async function renameView(id: string, name: string, actor: SessionUser): Promise<void> {
  const owned = await ownedBy(id, actor.id)
  if (!owned) throw new NotFoundError('View')
  const trimmed = name.trim().replace(/\s+/g, ' ')
  if (!trimmed) throw new ValidationError('Give the view a name.', { name: 'Required.' })
  await db.update(savedViews)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(savedViews.id, id))
}

export async function updateViewQuery(id: string, query: string, actor: SessionUser): Promise<void> {
  const owned = await ownedBy(id, actor.id)
  if (!owned) throw new NotFoundError('View')
  await db.update(savedViews)
    .set({ query: query.replace(/^\?/, '').slice(0, MAX_QUERY_LENGTH), updatedAt: new Date() })
    .where(eq(savedViews.id, id))
}

export async function setViewShared(id: string, shared: boolean, actor: SessionUser): Promise<void> {
  const owned = await ownedBy(id, actor.id)
  if (!owned) throw new NotFoundError('View')
  await db.update(savedViews)
    .set({ shared, updatedAt: new Date() })
    .where(eq(savedViews.id, id))
}

/**
 * Soft, so the name is freed and the view is recoverable.
 *
 * A saved view is cheap to delete by accident — it is one item in a menu of
 * chips — and expensive to rebuild, because rebuilding it means remembering
 * the filter somebody set up months ago.
 */
export async function deleteView(id: string, actor: SessionUser): Promise<void> {
  const owned = await ownedBy(id, actor.id)
  if (!owned) throw new NotFoundError('View')
  await db.update(savedViews)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(savedViews.id, id))
}

/**
 * Only the person who made a view can change it.
 *
 * A shared view is visible to everybody and editable by its author. The
 * alternative — anybody may edit anything shared — means one person's
 * carefully built view silently becomes somebody else's, and the first anybody
 * knows is that the list they open every morning shows different rows.
 */
async function ownedBy(id: string, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: savedViews.id })
    .from(savedViews)
    .where(and(eq(savedViews.id, id), eq(savedViews.userId, userId), isNull(savedViews.deletedAt)))
    .limit(1)
  return Boolean(row)
}
