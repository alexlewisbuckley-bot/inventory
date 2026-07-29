import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import {
  activities, brands, customers, customerBrands, deals, dealStageEvents, notifications,
  offers, requestEnquiries, tasks, users, watches, watchRequests,
} from '../db/schema'
import { recordAudit } from './audit'
import { diff } from '@/lib/diff'
import { newId } from '@/lib/ids'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { DEAL_STAGE_PROBABILITY, type ActivityType, type DealStage } from '@/lib/enums'
import type {
  ActivityInput, CustomerInput, DealInput, OfferInput, TaskInput, WatchRequestInput,
} from '@/lib/validation'
import type { SessionUser } from '../auth/session'

/**
 * Writes for the CRM.
 *
 * Two rules run through everything here.
 *
 * The timeline is written by the same code that makes the change, inside the
 * same transaction. A relationship history assembled afterwards from audit
 * rows is a reconstruction; one written as it happens is a record.
 *
 * And a deal is the sale before it is a sale. Winning one does not create a
 * second revenue number — it points at the ledger row that already exists.
 */

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/**
 * Human-quotable references (C-0142, D-0087).
 *
 * Sequential rather than random because these get read down a phone. The count
 * is taken inside the transaction that inserts, so two people adding a
 * customer at once cannot collide on the number.
 */
async function nextReference(prefix: 'C' | 'D'): Promise<string> {
  const [row] = prefix === 'C'
    ? await db.select({ value: sql<number>`count(*)` }).from(customers)
    : await db.select({ value: sql<number>`count(*)` }).from(deals)
  const next = Number(row?.value ?? 0) + 1
  return `${prefix}-${String(next).padStart(4, '0')}`
}

// ---------------------------------------------------------------------------
// Activities — the timeline primitive
// ---------------------------------------------------------------------------

export interface ActivityScope {
  customerId?: string | null
  supplierId?: string | null
  watchId?: string | null
  dealId?: string | null
  requestId?: string | null
}

/**
 * Append to the timeline.
 *
 * `isSystem` separates what the application noticed from what a person did, so
 * a real conversation is not buried under stage changes.
 */
export async function logActivity(input: {
  type: ActivityType
  subject?: string | null
  body?: string | null
  direction?: 'INBOUND' | 'OUTBOUND' | 'INTERNAL'
  occurredAt?: Date
  durationMin?: number | null
  isSystem?: boolean
  scope: ActivityScope
  actorId?: string | null
}): Promise<string> {
  const id = newId('act')
  await db.insert(activities).values({
    id,
    type: input.type,
    direction: input.direction ?? 'OUTBOUND',
    subject: input.subject ?? null,
    body: input.body ?? null,
    occurredAt: input.occurredAt ?? new Date(),
    durationMin: input.durationMin ?? null,
    isSystem: input.isSystem ?? false,
    customerId: input.scope.customerId ?? null,
    supplierId: input.scope.supplierId ?? null,
    watchId: input.scope.watchId ?? null,
    dealId: input.scope.dealId ?? null,
    requestId: input.scope.requestId ?? null,
    actorId: input.actorId ?? null,
  })

  // Talking to somebody is the thing that makes them "recently contacted", so
  // the field is maintained here rather than being another thing to remember.
  if (input.scope.customerId && !input.isSystem) {
    await db.update(customers)
      .set({ lastContactedAt: input.occurredAt ?? new Date(), updatedAt: new Date() })
      .where(eq(customers.id, input.scope.customerId))
  }

  return id
}

export async function createActivity(input: ActivityInput, actor: SessionUser): Promise<string> {
  if (!input.customerId && !input.supplierId && !input.watchId && !input.dealId && !input.requestId) {
    throw new ValidationError('An activity has to be about something — pick a customer, watch or deal.')
  }
  return logActivity({
    type: input.type,
    subject: input.subject,
    body: input.body,
    direction: input.direction,
    occurredAt: input.occurredAt,
    durationMin: input.durationMin ?? null,
    scope: input,
    actorId: actor.id,
  })
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export async function createCustomer(input: CustomerInput, actor: SessionUser): Promise<string> {
  return withTransaction(async () => {
    if (input.email) {
      const [clash] = await db.select({ id: customers.id }).from(customers)
        .where(and(eq(customers.email, input.email), isNull(customers.deletedAt))).limit(1)
      if (clash) {
        throw new ValidationError('A customer with that email address already exists.', {
          email: 'Already on file.',
        })
      }
    }

    const id = newId('cus')
    await db.insert(customers).values({
      id,
      reference: await nextReference('C'),
      firstName: input.firstName,
      lastName: input.lastName,
      company: input.company,
      email: input.email,
      phone: input.phone,
      altPhone: input.altPhone,
      country: input.country,
      city: input.city,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      postcode: input.postcode,
      preferredChannel: input.preferredChannel,
      tier: input.tier,
      status: input.status,
      leadSource: input.leadSource,
      budgetMinGbp: input.budgetMinGbp,
      budgetMaxGbp: input.budgetMaxGbp,
      birthday: input.birthday,
      notes: input.notes,
      riskNotes: input.riskNotes,
      marketingConsent: input.marketingConsent,
      // Consent is only meaningful with a date against it.
      consentRecordedAt: input.marketingConsent ? new Date() : null,
      ownerId: input.ownerId ?? actor.id,
    })

    await setFavouriteBrands(id, input.brandIds ?? [])

    await recordAudit({
      entityType: 'Customer', entityId: id, action: 'CREATE', actorId: actor.id,
      summary: `${input.firstName} ${input.lastName} added to the customer book`,
    })
    await logActivity({
      type: 'SYSTEM', subject: 'Customer created', isSystem: true,
      scope: { customerId: id }, actorId: actor.id,
    })
    return id
  })
}

export async function updateCustomer(id: string, input: CustomerInput, actor: SessionUser): Promise<void> {
  await withTransaction(async () => {
    const [existing] = await db.select().from(customers).where(eq(customers.id, id)).limit(1)
    if (!existing || existing.deletedAt) throw new NotFoundError('Customer')

    if (input.email && input.email !== existing.email) {
      const [clash] = await db.select({ id: customers.id }).from(customers)
        .where(and(eq(customers.email, input.email), isNull(customers.deletedAt))).limit(1)
      if (clash && clash.id !== id) {
        throw new ValidationError('Another customer already has that email address.', {
          email: 'Already on file.',
        })
      }
    }

    await db.update(customers).set({
      firstName: input.firstName,
      lastName: input.lastName,
      company: input.company,
      email: input.email,
      phone: input.phone,
      altPhone: input.altPhone,
      country: input.country,
      city: input.city,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      postcode: input.postcode,
      preferredChannel: input.preferredChannel,
      tier: input.tier,
      status: input.status,
      leadSource: input.leadSource,
      budgetMinGbp: input.budgetMinGbp,
      budgetMaxGbp: input.budgetMaxGbp,
      birthday: input.birthday,
      notes: input.notes,
      riskNotes: input.riskNotes,
      marketingConsent: input.marketingConsent,
      consentRecordedAt: input.marketingConsent
        ? existing.consentRecordedAt ?? new Date()
        : null,
      ownerId: input.ownerId,
      updatedAt: new Date(),
    }).where(eq(customers.id, id))

    await setFavouriteBrands(id, input.brandIds ?? [])

    const changes = diff(existing, input, [
      'firstName', 'lastName', 'company', 'email', 'phone', 'country', 'tier',
      'status', 'leadSource', 'preferredChannel', 'ownerId', 'marketingConsent',
    ])

    await recordAudit({
      entityType: 'Customer', entityId: id, action: 'UPDATE', actorId: actor.id,
      summary: `${input.firstName} ${input.lastName} updated`,
      changes,
    })

    // A quiet field edit is not worth a timeline row; a change of tier or owner
    // is the kind of thing a colleague needs to see they did not do.
    if (changes && (changes.tier || changes.ownerId || changes.status)) {
      await logActivity({
        type: 'SYSTEM', isSystem: true, scope: { customerId: id }, actorId: actor.id,
        subject: changes?.tier
          ? `Tier changed to ${input.tier.toLowerCase()}`
          : changes?.status
            ? `Marked ${input.status.toLowerCase()}`
            : 'Account manager changed',
      })
    }
  })
}

export async function deleteCustomer(id: string, actor: SessionUser): Promise<void> {
  await withTransaction(async () => {
    const [existing] = await db.select().from(customers).where(eq(customers.id, id)).limit(1)
    if (!existing || existing.deletedAt) throw new NotFoundError('Customer')

    // A customer who has bought something is part of the ledger's story. Soft
    // delete only, and the sales keep pointing at them.
    await db.update(customers)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(customers.id, id))

    await recordAudit({
      entityType: 'Customer', entityId: id, action: 'DELETE', actorId: actor.id,
      summary: `${existing.firstName} ${existing.lastName} removed`,
    })
  })
}

async function setFavouriteBrands(customerId: string, brandIds: string[]): Promise<void> {
  await db.delete(customerBrands).where(eq(customerBrands.customerId, customerId))
  if (brandIds.length === 0) return
  const valid = await db.select({ id: brands.id }).from(brands).where(inArray(brands.id, brandIds))
  if (valid.length === 0) return
  await db.insert(customerBrands).values(valid.map((brand) => ({ customerId, brandId: brand.id })))
}

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

export async function createDeal(input: DealInput, actor: SessionUser): Promise<string> {
  return withTransaction(async () => {
    const id = newId('dea')
    const stage = input.stage
    await db.insert(deals).values({
      id,
      reference: await nextReference('D'),
      title: input.title,
      customerId: input.customerId,
      watchId: input.watchId,
      stage,
      valueGbp: input.valueGbp ?? await defaultValueFor(input.watchId),
      probability: input.probability ?? DEAL_STAGE_PROBABILITY[stage],
      expectedClose: input.expectedClose,
      ownerId: input.ownerId ?? actor.id,
      source: input.source,
      notes: input.notes,
      stageChangedAt: new Date(),
    })

    await db.insert(dealStageEvents).values({
      id: newId('dse'), dealId: id, fromStage: null, toStage: stage, actorId: actor.id,
    })

    await recordAudit({
      entityType: 'Deal', entityId: id, action: 'CREATE', actorId: actor.id,
      summary: `${input.title} opened`,
    })
    await logActivity({
      type: 'SYSTEM', subject: 'Deal opened', isSystem: true,
      scope: { dealId: id, customerId: input.customerId, watchId: input.watchId },
      actorId: actor.id,
    })
    return id
  })
}

/** A deal against a watch is worth the asking price until somebody says otherwise. */
async function defaultValueFor(watchId: string | null): Promise<number | null> {
  if (!watchId) return null
  const [watch] = await db.select({ estSaleGbp: watches.estSaleGbp })
    .from(watches).where(eq(watches.id, watchId)).limit(1)
  return watch?.estSaleGbp ?? null
}

export async function updateDeal(id: string, input: DealInput, actor: SessionUser): Promise<void> {
  await withTransaction(async () => {
    const [existing] = await db.select().from(deals).where(eq(deals.id, id)).limit(1)
    if (!existing || existing.deletedAt) throw new NotFoundError('Deal')

    await db.update(deals).set({
      title: input.title,
      customerId: input.customerId,
      watchId: input.watchId,
      valueGbp: input.valueGbp,
      probability: input.probability ?? existing.probability,
      expectedClose: input.expectedClose,
      ownerId: input.ownerId,
      source: input.source,
      notes: input.notes,
      updatedAt: new Date(),
    }).where(eq(deals.id, id))

    await recordAudit({
      entityType: 'Deal', entityId: id, action: 'UPDATE', actorId: actor.id,
      summary: `${input.title} updated`,
      changes: diff(existing, input, ['title', 'valueGbp', 'expectedClose', 'ownerId', 'customerId', 'watchId']),
    })
  })
}

/**
 * Move a deal to another stage.
 *
 * The stage is the deal's state machine, so the move writes three things: the
 * new stage, an immutable event for cycle-time reporting, and a timeline row
 * on every entity involved. Probability follows the stage unless it has been
 * set by hand, which is the difference between a forecast people trust and one
 * they ignore.
 */
export async function moveDeal(
  id: string,
  stage: DealStage,
  actor: SessionUser,
  options: { lostReason?: string | null; sortOrder?: number } = {},
): Promise<void> {
  await withTransaction(async () => {
    const [existing] = await db.select().from(deals).where(eq(deals.id, id)).limit(1)
    if (!existing || existing.deletedAt) throw new NotFoundError('Deal')

    if (stage === 'LOST' && !options.lostReason) {
      throw new ValidationError('Say why it was lost — that is the only reason this stage is useful later.', {
        lostReason: 'A reason is required.',
      })
    }

    const unchanged = existing.stage === stage
    const followedStage = existing.probability === DEAL_STAGE_PROBABILITY[existing.stage as DealStage]

    await db.update(deals).set({
      stage,
      // Reordering within a column is not a stage change and must not reset the clock.
      stageChangedAt: unchanged ? existing.stageChangedAt : new Date(),
      probability: followedStage ? DEAL_STAGE_PROBABILITY[stage] : existing.probability,
      closedAt: stage === 'WON' || stage === 'LOST' ? new Date() : null,
      lostReason: stage === 'LOST' ? options.lostReason ?? null : null,
      sortOrder: options.sortOrder ?? existing.sortOrder,
      updatedAt: new Date(),
    }).where(eq(deals.id, id))

    if (unchanged) return

    await db.insert(dealStageEvents).values({
      id: newId('dse'), dealId: id, fromStage: existing.stage, toStage: stage, actorId: actor.id,
    })

    await recordAudit({
      entityType: 'Deal', entityId: id, action: 'UPDATE', actorId: actor.id,
      summary: `${existing.title} moved to ${stage.replace('_', ' ').toLowerCase()}`,
      changes: { stage: { from: existing.stage, to: stage } },
    })

    await logActivity({
      type: 'STAGE_CHANGE',
      subject: `Moved to ${stage.replace('_', ' ').toLowerCase()}`,
      body: stage === 'LOST' ? options.lostReason ?? null : null,
      isSystem: true,
      scope: { dealId: id, customerId: existing.customerId, watchId: existing.watchId },
      actorId: actor.id,
    })

    // Winning generates the work that follows a sale, so nobody has to remember
    // what "won" actually obliges them to do.
    if (stage === 'WON') await generateWinTasks(existing.id, existing.customerId, existing.watchId, actor)
  })
}

async function generateWinTasks(
  dealId: string, customerId: string | null, watchId: string | null, actor: SessionUser,
): Promise<void> {
  const due = (days: number) => new Date(Date.now() + days * 86_400_000)
  const planned = [
    { title: 'Raise the invoice', kind: 'ADMIN' as const, days: 0 },
    { title: 'Arrange delivery or collection', kind: 'DELIVERY' as const, days: 2 },
    { title: 'Follow up that the watch arrived safely', kind: 'FOLLOW_UP' as const, days: 10 },
  ]
  for (const task of planned) {
    await db.insert(tasks).values({
      id: newId('tsk'),
      title: task.title,
      kind: task.kind,
      dueAt: due(task.days),
      assigneeId: actor.id,
      dealId,
      customerId,
      watchId,
      autoKey: `deal-won:${dealId}:${task.kind}`,
      createdBy: actor.id,
    }).onConflictDoNothing()
  }
}

export async function deleteDeal(id: string, actor: SessionUser): Promise<void> {
  const [existing] = await db.select().from(deals).where(eq(deals.id, id)).limit(1)
  if (!existing || existing.deletedAt) throw new NotFoundError('Deal')
  await db.update(deals).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(deals.id, id))
  await recordAudit({
    entityType: 'Deal', entityId: id, action: 'DELETE', actorId: actor.id,
    summary: `${existing.title} deleted`,
  })
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

export async function createOffer(
  input: OfferInput, amountGbp: number, actor: SessionUser,
): Promise<string> {
  const id = newId('off')
  const amount = Math.round(Number(input.amount.replace(/[^0-9.]/g, '')) * 100)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError('Enter the amount that was offered.', { amount: 'Enter an amount.' })
  }

  await db.insert(offers).values({
    id,
    dealId: input.dealId,
    customerId: input.customerId,
    watchId: input.watchId,
    amount,
    currency: input.currency,
    amountGbp,
    validUntil: input.validUntil,
    notes: input.notes,
    createdBy: actor.id,
  })

  await logActivity({
    type: 'OFFER',
    subject: 'Offer sent',
    body: input.notes,
    scope: { dealId: input.dealId, customerId: input.customerId, watchId: input.watchId },
    actorId: actor.id,
  })

  // An offer sitting unanswered is the single most common way a deal dies
  // quietly, so chasing it is scheduled rather than hoped for.
  if (input.dealId || input.customerId) {
    await db.insert(tasks).values({
      id: newId('tsk'),
      title: 'Chase the offer',
      kind: 'FOLLOW_UP',
      dueAt: new Date(Date.now() + 3 * 86_400_000),
      assigneeId: actor.id,
      dealId: input.dealId,
      customerId: input.customerId,
      watchId: input.watchId,
      autoKey: `offer-chase:${id}`,
      createdBy: actor.id,
    }).onConflictDoNothing()
  }

  return id
}

export async function respondToOffer(
  id: string, status: 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN' | 'EXPIRED', actor: SessionUser,
): Promise<void> {
  const [existing] = await db.select().from(offers).where(eq(offers.id, id)).limit(1)
  if (!existing) throw new NotFoundError('Offer')

  await db.update(offers)
    .set({ status, respondedAt: new Date(), updatedAt: new Date() })
    .where(eq(offers.id, id))

  await logActivity({
    type: 'OFFER',
    direction: 'INBOUND',
    subject: `Offer ${status.toLowerCase()}`,
    isSystem: true,
    scope: { dealId: existing.dealId, customerId: existing.customerId, watchId: existing.watchId },
    actorId: actor.id,
  })

  // The chase is pointless once they have answered.
  await db.update(tasks)
    .set({ status: 'CANCELLED', updatedAt: new Date() })
    .where(and(eq(tasks.autoKey, `offer-chase:${id}`), eq(tasks.status, 'OPEN')))

  if (status === 'ACCEPTED' && existing.dealId) {
    await moveDeal(existing.dealId, 'NEGOTIATION', actor).catch(() => {
      // A deal already further along should not be dragged backwards.
    })
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function createTask(input: TaskInput, actor: SessionUser): Promise<string> {
  const id = newId('tsk')
  await db.insert(tasks).values({
    id,
    title: input.title,
    notes: input.notes,
    kind: input.kind,
    priority: input.priority,
    dueAt: input.dueAt,
    assigneeId: input.assigneeId ?? actor.id,
    customerId: input.customerId,
    supplierId: input.supplierId,
    watchId: input.watchId,
    dealId: input.dealId,
    requestId: input.requestId,
    createdBy: actor.id,
  })
  return id
}

export async function completeTask(id: string, done: boolean, actor: SessionUser): Promise<void> {
  const [existing] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1)
  if (!existing || existing.deletedAt) throw new NotFoundError('Task')

  await db.update(tasks).set({
    status: done ? 'DONE' : 'OPEN',
    completedAt: done ? new Date() : null,
    completedBy: done ? actor.id : null,
    updatedAt: new Date(),
  }).where(eq(tasks.id, id))

  if (done && (existing.customerId || existing.dealId)) {
    await logActivity({
      type: 'SYSTEM', subject: `Task done: ${existing.title}`, isSystem: true,
      scope: { customerId: existing.customerId, dealId: existing.dealId, watchId: existing.watchId },
      actorId: actor.id,
    })
  }
}

export async function updateTask(id: string, input: TaskInput, actor: SessionUser): Promise<void> {
  const [existing] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1)
  if (!existing || existing.deletedAt) throw new NotFoundError('Task')
  await db.update(tasks).set({
    title: input.title,
    notes: input.notes,
    kind: input.kind,
    priority: input.priority,
    dueAt: input.dueAt,
    assigneeId: input.assigneeId,
    updatedAt: new Date(),
  }).where(eq(tasks.id, id))
  void actor
}

// ---------------------------------------------------------------------------
// Watch requests
// ---------------------------------------------------------------------------

export async function createRequest(input: WatchRequestInput, actor: SessionUser): Promise<string> {
  const id = newId('req')
  await db.insert(watchRequests).values({
    id,
    customerId: input.customerId,
    brandId: input.brandId,
    model: input.model,
    referenceNo: input.referenceNo,
    dial: input.dial,
    bracelet: input.bracelet,
    condition: input.condition,
    boxPapers: input.boxPapers,
    budgetGbp: input.budgetGbp,
    targetDate: input.targetDate,
    priority: input.priority,
    status: input.status,
    notes: input.notes,
    ownerId: input.ownerId ?? actor.id,
  })

  await recordAudit({
    entityType: 'Request', entityId: id, action: 'CREATE', actorId: actor.id,
    summary: 'Watch request registered',
  })
  await logActivity({
    type: 'SYSTEM', subject: 'Registered interest in a watch', isSystem: true,
    scope: { customerId: input.customerId, requestId: id }, actorId: actor.id,
  })
  return id
}

export async function updateRequestStatus(
  id: string, status: 'OPEN' | 'SOURCING' | 'MATCHED' | 'FULFILLED' | 'CANCELLED', actor: SessionUser,
): Promise<void> {
  const [existing] = await db.select().from(watchRequests).where(eq(watchRequests.id, id)).limit(1)
  if (!existing || existing.deletedAt) throw new NotFoundError('Request')

  await db.update(watchRequests)
    .set({ status, updatedAt: new Date() })
    .where(eq(watchRequests.id, id))

  await logActivity({
    type: 'SYSTEM', subject: `Request marked ${status.toLowerCase()}`, isSystem: true,
    scope: { customerId: existing.customerId, requestId: id }, actorId: actor.id,
  })
}

export async function recordEnquiry(
  input: { requestId: string; supplierId: string | null; status: 'SENT' | 'QUOTED' | 'DECLINED' | 'NO_REPLY'; quotedGbp: number | null; notes: string | null },
  actor: SessionUser,
): Promise<string> {
  const id = newId('enq')
  await db.insert(requestEnquiries).values({ id, ...input, actorId: actor.id })

  // Asking a supplier is what "sourcing" means; the status should not need a
  // second, separate action.
  await db.update(watchRequests)
    .set({ status: 'SOURCING', updatedAt: new Date() })
    .where(and(eq(watchRequests.id, input.requestId), eq(watchRequests.status, 'OPEN')))

  await logActivity({
    type: 'SYSTEM', subject: 'Supplier asked to source', isSystem: true,
    scope: { requestId: input.requestId, supplierId: input.supplierId }, actorId: actor.id,
  })
  return id
}

// ---------------------------------------------------------------------------
// Matching — the point where the two halves meet
// ---------------------------------------------------------------------------

/**
 * Watches already in stock that satisfy a request.
 *
 * Deliberately generous: brand, then reference number, then budget. A list
 * that is slightly too long is useful; one that is too strict quietly tells
 * you there is nothing when there is.
 */
export async function matchesForRequest(requestId: string) {
  const [request] = await db.select().from(watchRequests).where(eq(watchRequests.id, requestId)).limit(1)
  if (!request) return []

  const clauses = [
    isNull(watches.deletedAt),
    inArray(watches.status, ['IN_STOCK', 'RESERVED']),
  ]
  if (request.brandId) clauses.push(eq(watches.brandId, request.brandId))
  if (request.referenceNo) clauses.push(ilike(watches.model, `%${request.referenceNo}%`))
  if (request.budgetGbp) clauses.push(lte(watches.estSaleGbp, Math.round(request.budgetGbp * 1.1)))

  return db.select({
    id: watches.id,
    stockNo: watches.stockNo,
    model: watches.model,
    brandName: brands.name,
    estSaleGbp: watches.estSaleGbp,
    status: watches.status,
    condition: watches.condition,
  })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .where(and(...clauses))
    .orderBy(watches.estSaleGbp)
    .limit(10)
}

/**
 * A watch has arrived; tell the people waiting for one like it.
 *
 * Called when stock is booked in. The request moves to MATCHED and its owner
 * gets a notification, because the whole value of taking a request down is
 * being the first to call back.
 */
export async function notifyMatchingRequests(watchId: string, actorId: string): Promise<number> {
  const [watch] = await db.select({
    id: watches.id, brandId: watches.brandId, model: watches.model,
    stockNo: watches.stockNo, estSaleGbp: watches.estSaleGbp,
  }).from(watches).where(eq(watches.id, watchId)).limit(1)
  if (!watch) return 0

  const candidates = await db.select({
    id: watchRequests.id,
    customerId: watchRequests.customerId,
    ownerId: watchRequests.ownerId,
    budgetGbp: watchRequests.budgetGbp,
    customerName: sql<string>`trim(coalesce(${customers.firstName}, '') || ' ' || coalesce(${customers.lastName}, ''))`,
  })
    .from(watchRequests)
    .innerJoin(customers, eq(customers.id, watchRequests.customerId))
    .where(and(
      isNull(watchRequests.deletedAt),
      inArray(watchRequests.status, ['OPEN', 'SOURCING']),
      eq(watchRequests.brandId, watch.brandId),
    ))

  const matched = candidates.filter((request) => {
    if (!request.budgetGbp || watch.estSaleGbp === null) return true
    // A tenth over budget is a conversation, not a mismatch.
    return watch.estSaleGbp <= request.budgetGbp * 1.1
  })

  for (const request of matched) {
    await db.update(watchRequests)
      .set({ status: 'MATCHED', updatedAt: new Date() })
      .where(eq(watchRequests.id, request.id))

    await logActivity({
      type: 'SYSTEM',
      subject: `Stock ${watch.stockNo} matches this request`,
      isSystem: true,
      scope: { customerId: request.customerId, requestId: request.id, watchId: watch.id },
      actorId,
    })

    if (request.ownerId) {
      await db.insert(notifications).values({
        id: newId('ntf'),
        userId: request.ownerId,
        type: 'STOCK_ADDED',
        title: 'A watch just arrived that somebody is waiting for',
        body: `Stock ${watch.stockNo} matches ${request.customerName}'s request.`,
        entityType: 'Watch',
        entityId: watch.id,
      })

      await db.insert(tasks).values({
        id: newId('tsk'),
        title: `Call ${request.customerName} — their watch is in stock`,
        kind: 'CALL',
        priority: 'HIGH',
        dueAt: new Date(Date.now() + 86_400_000),
        assigneeId: request.ownerId,
        customerId: request.customerId,
        requestId: request.id,
        watchId: watch.id,
        autoKey: `request-match:${request.id}:${watch.id}`,
        createdBy: actorId,
      }).onConflictDoNothing()
    }
  }

  return matched.length
}

// ---------------------------------------------------------------------------
// Dashboard aggregates
// ---------------------------------------------------------------------------

export async function crmSummary(userId: string) {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(startOfDay.getTime() + 86_400_000)

  const [pipeline, dueToday, overdue, hotDeals, birthdays, quietVips] = await Promise.all([
    db.select({
      stage: deals.stage,
      count: sql<number>`count(*)`,
      value: sql<number>`coalesce(sum(${deals.valueGbp}), 0)`,
      weighted: sql<number>`coalesce(sum(${deals.valueGbp} * ${deals.probability} / 100), 0)`,
    })
      .from(deals)
      .where(and(isNull(deals.deletedAt), sql`${deals.stage} NOT IN ('WON', 'LOST')`))
      .groupBy(deals.stage),

    db.select({ value: sql<number>`count(*)` }).from(tasks)
      .where(and(
        isNull(tasks.deletedAt), eq(tasks.status, 'OPEN'),
        gte(tasks.dueAt, startOfDay), lte(tasks.dueAt, endOfDay),
        eq(tasks.assigneeId, userId),
      )),

    db.select({ value: sql<number>`count(*)` }).from(tasks)
      .where(and(
        isNull(tasks.deletedAt), eq(tasks.status, 'OPEN'),
        lte(tasks.dueAt, startOfDay), eq(tasks.assigneeId, userId),
      )),

    db.select({
      id: deals.id, title: deals.title, stage: deals.stage, valueGbp: deals.valueGbp,
      probability: deals.probability, expectedClose: deals.expectedClose,
      customerName: sql<string | null>`nullif(trim(coalesce(${customers.firstName}, '') || ' ' || coalesce(${customers.lastName}, '')), '')`,
    })
      .from(deals)
      .leftJoin(customers, eq(customers.id, deals.customerId))
      .where(and(isNull(deals.deletedAt), sql`${deals.stage} NOT IN ('WON', 'LOST')`))
      .orderBy(desc(sql`coalesce(${deals.valueGbp}, 0) * ${deals.probability}`))
      .limit(5),

    // Birthdays inside the next fortnight, ignoring the year.
    db.select({
      id: customers.id, firstName: customers.firstName, lastName: customers.lastName,
      birthday: customers.birthday, tier: customers.tier,
    })
      .from(customers)
      .where(and(
        isNull(customers.deletedAt),
        sql`${customers.birthday} IS NOT NULL`,
        sql`(to_char(${customers.birthday}, 'MM-DD') >= to_char(now(), 'MM-DD')
             AND to_char(${customers.birthday}, 'MM-DD') <= to_char(now() + interval '14 days', 'MM-DD'))
            OR (to_char(now() + interval '14 days', 'MM-DD') < to_char(now(), 'MM-DD')
                AND (to_char(${customers.birthday}, 'MM-DD') >= to_char(now(), 'MM-DD')
                     OR to_char(${customers.birthday}, 'MM-DD') <= to_char(now() + interval '14 days', 'MM-DD')))`,
      ))
      .orderBy(sql`to_char(${customers.birthday}, 'MM-DD')`)
      .limit(8),

    // A VIP nobody has spoken to in three months is the most expensive silence
    // in the business.
    db.select({
      id: customers.id, firstName: customers.firstName, lastName: customers.lastName,
      lastContactedAt: customers.lastContactedAt, tier: customers.tier,
    })
      .from(customers)
      .where(and(
        isNull(customers.deletedAt),
        eq(customers.status, 'ACTIVE'),
        inArray(customers.tier, ['VIP', 'PRIORITY']),
        or(
          isNull(customers.lastContactedAt),
          lte(customers.lastContactedAt, new Date(Date.now() - 90 * 86_400_000)),
        )!,
      ))
      .orderBy(sql`${customers.lastContactedAt} ASC NULLS FIRST`)
      .limit(6),
  ])

  return {
    pipeline: pipeline.map((row) => ({
      stage: row.stage as DealStage,
      count: Number(row.count),
      value: Number(row.value),
      weighted: Number(row.weighted),
    })),
    tasksDueToday: Number(dueToday[0]?.value ?? 0),
    tasksOverdue: Number(overdue[0]?.value ?? 0),
    hotDeals,
    birthdays,
    quietVips,
  }
}

/** Users who can own a customer or a deal. */
export async function assignableUsers() {
  return db.select({ id: users.id, name: users.name, initials: users.initials })
    .from(users)
    .where(and(eq(users.isActive, true), isNull(users.deletedAt)))
    .orderBy(users.name)
}
