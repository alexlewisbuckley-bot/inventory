import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client'
import {
  brands, customers, notifications, requestEnquiries, suppliers, tasks,
  watches, watchRequests,
} from '../db/schema'
import { logActivity } from './crm-service'
import { newId } from '@/lib/ids'
import { NotFoundError } from '@/lib/errors'
import { toMajor } from '@/lib/money'
import type { SessionUser } from '../auth/session'

/**
 * The purchase loop, closed.
 *
 * Everything upstream of this already existed: a want is registered, suppliers
 * are asked, quotes are logged. What was missing was the downhill half — a
 * quote you decide to take had to be retyped into the intake form field by
 * field, and the want it satisfied stayed OPEN until somebody remembered it.
 * Retyping is where transcription errors live, and "somebody remembers" is
 * where fulfilled wants went to stay open forever.
 *
 * Two functions. `sourcingPrefill` turns an accepted quote into the intake
 * form's starting values; `completeSourcing` runs after the watch is booked
 * in and settles the paperwork — the want is fulfilled, the timeline says so
 * on both the customer and the request, the request's owner is told, and a
 * task to offer the watch exists so the arrival is followed by a phone call
 * rather than by silence.
 */

export interface SourcingPrefill {
  requestId: string
  customerName: string
  brandId: string | null
  brandName: string | null
  model: string | null
  referenceNo: string | null
  supplierId: string | null
  supplierName: string | null
  /** Major units, as the form expects. From the accepted quote. */
  purchaseAmount: string
  /** Major units. From the customer's budget, as the opening estimate. */
  estSaleAmount: string
  notes: string
}

/**
 * What the intake form should start with, given a request and the quote
 * being accepted.
 *
 * The quoted price becomes the purchase price and the customer's budget
 * becomes the opening sale estimate — both editable on the form, because a
 * prefill is a head start, not a decision. The note names the customer so
 * the provenance survives even if somebody clears the linkage.
 */
export async function sourcingPrefill(
  requestId: string,
  enquiryId: string | null,
): Promise<SourcingPrefill | null> {
  const [request] = await db.select({
    id: watchRequests.id,
    brandId: watchRequests.brandId,
    model: watchRequests.model,
    referenceNo: watchRequests.referenceNo,
    budgetGbp: watchRequests.budgetGbp,
    brandName: brands.name,
    customerName: sql<string>`trim(coalesce(${customers.firstName}, '') || ' ' || coalesce(${customers.lastName}, ''))`,
  })
    .from(watchRequests)
    .leftJoin(brands, eq(brands.id, watchRequests.brandId))
    .innerJoin(customers, eq(customers.id, watchRequests.customerId))
    .where(and(eq(watchRequests.id, requestId), isNull(watchRequests.deletedAt)))
    .limit(1)
  if (!request) return null

  let supplierId: string | null = null
  let supplierName: string | null = null
  let quotedGbp: number | null = null

  if (enquiryId) {
    const [enquiry] = await db.select({
      supplierId: requestEnquiries.supplierId,
      supplierName: suppliers.name,
      quotedGbp: requestEnquiries.quotedGbp,
      requestId: requestEnquiries.requestId,
    })
      .from(requestEnquiries)
      .leftJoin(suppliers, eq(suppliers.id, requestEnquiries.supplierId))
      .where(eq(requestEnquiries.id, enquiryId))
      .limit(1)
    // An enquiry from a different request is a mangled URL, not a prefill.
    if (enquiry && enquiry.requestId === requestId) {
      supplierId = enquiry.supplierId
      supplierName = enquiry.supplierName
      quotedGbp = enquiry.quotedGbp
    }
  }

  return {
    requestId: request.id,
    customerName: request.customerName,
    brandId: request.brandId,
    brandName: request.brandName,
    model: [request.model, request.referenceNo].filter(Boolean).join(' ') || null,
    referenceNo: request.referenceNo,
    supplierId,
    supplierName,
    purchaseAmount: quotedGbp !== null ? String(toMajor(quotedGbp)) : '',
    estSaleAmount: request.budgetGbp !== null ? String(toMajor(request.budgetGbp)) : '',
    notes: `Sourced for ${request.customerName}${supplierName ? ` — quoted by ${supplierName}` : ''}.`,
  }
}

/**
 * The paperwork after the watch is booked in.
 *
 * Runs after intake and never throws intake back out: a watch that exists in
 * stock is a fact, and a hiccup in the follow-up must not unmake it. Callers
 * wrap this in a catch for the same reason recording a sale survives a deal
 * update failing.
 */
export async function completeSourcing(
  watchId: string,
  requestId: string,
  actor: SessionUser,
): Promise<void> {
  const [request] = await db.select({
    id: watchRequests.id,
    status: watchRequests.status,
    customerId: watchRequests.customerId,
    ownerId: watchRequests.ownerId,
    customerName: sql<string>`trim(coalesce(${customers.firstName}, '') || ' ' || coalesce(${customers.lastName}, ''))`,
  })
    .from(watchRequests)
    .innerJoin(customers, eq(customers.id, watchRequests.customerId))
    .where(and(eq(watchRequests.id, requestId), isNull(watchRequests.deletedAt)))
    .limit(1)
  if (!request) throw new NotFoundError('Request')

  const [watch] = await db.select({
    id: watches.id, stockNo: watches.stockNo, model: watches.model,
  }).from(watches).where(eq(watches.id, watchId)).limit(1)
  if (!watch) throw new NotFoundError('Watch')

  await db.update(watchRequests)
    .set({ status: 'FULFILLED', updatedAt: new Date() })
    .where(eq(watchRequests.id, requestId))

  await logActivity({
    type: 'SYSTEM',
    subject: `Sourced: stock ${watch.stockNo} booked in for this request`,
    body: `${watch.model} is in stock and linked to ${request.customerName}'s want.`,
    isSystem: true,
    scope: { customerId: request.customerId, requestId: request.id, watchId: watch.id },
    actorId: actor.id,
  })

  // The person who promised to find it hears that it has been found — unless
  // they are the one booking it in, in which case a notification would be the
  // system telling them what they just did.
  if (request.ownerId && request.ownerId !== actor.id) {
    await db.insert(notifications).values({
      id: newId('ntf'),
      userId: request.ownerId,
      type: 'STOCK_ADDED',
      title: `The watch you were sourcing for ${request.customerName} is in`,
      body: `Stock ${watch.stockNo} — ${watch.model} — was booked in against their request.`,
      entityType: 'Watch',
      entityId: watch.id,
    })
  }

  // Arrival is not the end of the loop; the offer is. The task carries an
  // autoKey so booking in twice against the same request cannot generate a
  // second identical instruction.
  await db.insert(tasks).values({
    id: newId('tsk'),
    title: `Offer stock ${watch.stockNo} to ${request.customerName} — sourced for them`,
    kind: 'CALL',
    priority: 'HIGH',
    dueAt: new Date(Date.now() + 86_400_000),
    assigneeId: request.ownerId ?? actor.id,
    customerId: request.customerId,
    requestId: request.id,
    watchId: watch.id,
    autoKey: `sourced:${request.id}:${watch.id}`,
    createdBy: actor.id,
  }).onConflictDoNothing()
}
