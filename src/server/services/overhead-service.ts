import { and, eq, isNull, sql } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import { overheads } from '../db/schema'
import { recordAudit } from './audit'
import { diff } from '@/lib/diff'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { newId } from '@/lib/ids'
import type { SessionUser } from '../auth/session'
import { OVERHEAD_CADENCES, OVERHEAD_CATEGORIES, type OverheadCadence, type OverheadCategory } from '@/lib/enums'

export interface OverheadInput {
  name: string
  category: OverheadCategory
  /** Base minor units, as the invoice reads, per occurrence. */
  amount: number
  cadence: OverheadCadence
  startsOn: string
  endsOn: string | null
  notes: string | null
  isActive: boolean
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Check a running cost before it becomes part of a net profit figure.
 *
 * Stricter than most forms in here on purpose. Everything on this table
 * feeds a number somebody will make a decision on, and the failure mode of
 * a bad row is not an error message — it is a plausible net profit that is
 * quietly wrong.
 */
function validate(input: OverheadInput): OverheadInput {
  const name = input.name.trim()
  if (!name) throw new ValidationError('A name is required.', { name: 'What is this cost?' })
  if (!OVERHEAD_CATEGORIES.includes(input.category)) {
    throw new ValidationError('Unknown category.', { category: 'Choose a category.' })
  }
  if (!OVERHEAD_CADENCES.includes(input.cadence)) {
    throw new ValidationError('Unknown frequency.', { cadence: 'Choose how often this falls due.' })
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new ValidationError('An amount is required.', { amount: 'Enter an amount above zero.' })
  }
  if (!DATE.test(input.startsOn)) {
    throw new ValidationError('A start date is required.', { startsOn: 'When did this start?' })
  }
  if (input.endsOn !== null) {
    if (!DATE.test(input.endsOn)) {
      throw new ValidationError('That end date is not a date.', { endsOn: 'Use a real date, or leave it blank.' })
    }
    // Reversed dates make a cost that applies to no month at all: it would
    // save, show nothing, and look like the report was broken.
    if (input.endsOn < input.startsOn) {
      throw new ValidationError('That cost ends before it starts.', {
        endsOn: 'This is before the start date.',
      })
    }
  }
  return { ...input, name, notes: input.notes?.trim() || null }
}

const FIELDS = ['name', 'category', 'amount', 'cadence', 'startsOn', 'endsOn', 'notes', 'isActive'] as const

export async function saveOverhead(
  id: string | null, raw: OverheadInput, actor: SessionUser,
): Promise<void> {
  const input = validate(raw)

  await withTransaction(async () => {
    if (id) {
      const before = await db.select().from(overheads).where(eq(overheads.id, id)).limit(1)
      if (!before[0] || before[0].deletedAt) throw new NotFoundError('Running cost')
      await db.update(overheads).set({ ...input, updatedAt: new Date() }).where(eq(overheads.id, id))
      await recordAudit({
        entityType: 'Overhead', entityId: id, action: 'UPDATE', actorId: actor.id,
        summary: `${before[0].name} updated`,
        changes: diff(before[0], input, [...FIELDS]),
      })
      return
    }

    const last = await db.select({ max: sql<number>`coalesce(max(${overheads.sortOrder}), 0)` }).from(overheads)
    const ident = newId('ovh')
    await db.insert(overheads).values({
      id: ident, ...input, sortOrder: Number(last[0]?.max ?? 0) + 10,
    })
    await recordAudit({
      entityType: 'Overhead', entityId: ident, action: 'CREATE', actorId: actor.id,
      summary: `${input.name} added to running costs`,
    })
  })
}

/**
 * Take a cost off the books.
 *
 * Soft, always. A deleted row would take every past month's net profit with
 * it — the rent you paid last year was still paid, and a P&L that silently
 * improves because somebody tidied up a cancelled subscription is worse
 * than one with an old line in it. Giving it an end date is the ordinary
 * act; this is for a row typed in by mistake.
 */
export async function deleteOverhead(id: string, actor: SessionUser): Promise<void> {
  await withTransaction(async () => {
    const rows = await db.select().from(overheads)
      .where(and(eq(overheads.id, id), isNull(overheads.deletedAt))).limit(1)
    const cost = rows[0]
    if (!cost) throw new NotFoundError('Running cost')

    await db.update(overheads).set({ deletedAt: new Date() }).where(eq(overheads.id, id))
    await recordAudit({
      entityType: 'Overhead', entityId: id, action: 'DELETE', actorId: actor.id,
      summary: `${cost.name} removed from running costs`,
    })
  })
}
