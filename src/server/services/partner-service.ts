import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { partners } from '../db/schema'
import { newId, slugify } from '@/lib/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { recordAudit } from './audit'
import { isUsableRate, MAX_DISCOUNT_BPS } from '@/lib/partner-rate'
import type { CurrencyCode } from '@/lib/enums'
import type { SessionUser } from '../auth/session'

/**
 * The partner register.
 *
 * A corporate that buys at an agreed rate and runs reward campaigns for its
 * staff. This file is the entity and the rate; the portal they log into and
 * the campaigns they run sit on top of it.
 */

export interface PartnerInput {
  name: string
  displayName?: string | null
  contactName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  website?: string | null
  discountBps: number
  displayCurrency: CurrencyCode
  brandColor?: string
  accentColor?: string
  notes?: string | null
  isActive?: boolean
  sortOrder?: number
}

export async function listPartners() {
  return db.select({
    id: partners.id,
    name: partners.name,
    slug: partners.slug,
    displayName: partners.displayName,
    contactName: partners.contactName,
    contactEmail: partners.contactEmail,
    contactPhone: partners.contactPhone,
    website: partners.website,
    discountBps: partners.discountBps,
    displayCurrency: partners.displayCurrency,
    brandColor: partners.brandColor,
    accentColor: partners.accentColor,
    notes: partners.notes,
    isActive: partners.isActive,
    sortOrder: partners.sortOrder,
    /*
     * The portal link, for staff to copy and hand over. The passphrase is
     * only ever a yes-or-no here: it is stored hashed and shown to nobody
     * again, including us, so a column that could answer "what is it" would
     * be a column that could leak it.
     */
    portalToken: partners.portalToken,
    portalOpen: sql<boolean>`${partners.portalPasswordHash} is not null`,
    portalPasswordSetAt: partners.portalPasswordSetAt,
  })
    .from(partners)
    .where(isNull(partners.deletedAt))
    .orderBy(asc(partners.sortOrder), asc(partners.name))
}

export async function getPartner(id: string) {
  const [found] = await db.select().from(partners)
    .where(and(eq(partners.id, id), isNull(partners.deletedAt))).limit(1)
  if (!found) throw new NotFoundError('Partner')
  return found
}

/**
 * The rate is checked here as well as in the form.
 *
 * The form is one way in and a server action is reachable without it. The
 * failure this stops is not a wrong page — it is a partner quoted at a fifth
 * of the asking price on every order afterwards, which reads as deliberate.
 */
function assertRate(bps: number): void {
  if (!isUsableRate(bps)) {
    throw new ValidationError('That rate cannot be right.', {
      discountBps: `Enter a discount between 0 and ${MAX_DISCOUNT_BPS / 100}%.`,
    })
  }
}

/** One live partner per name, so two people cannot open the same company twice. */
async function assertNameFree(slug: string, exceptId?: string): Promise<void> {
  const clash = await db.select({ id: partners.id }).from(partners)
    .where(and(
      eq(partners.slug, slug),
      isNull(partners.deletedAt),
      ...(exceptId ? [ne(partners.id, exceptId)] : []),
    ))
    .limit(1)
  if (clash[0]) throw new ConflictError('A partner with that name already exists.')
}

export async function createPartner(input: PartnerInput, actor: SessionUser): Promise<string> {
  assertRate(input.discountBps)
  const slug = slugify(input.name)
  if (!slug) throw new ValidationError('That name cannot be used.', { name: 'Give the company a name.' })
  await assertNameFree(slug)

  const id = newId('ptr')
  await db.insert(partners).values({
    id,
    name: input.name.trim(),
    slug,
    displayName: input.displayName?.trim() || null,
    contactName: input.contactName?.trim() || null,
    contactEmail: input.contactEmail?.trim() || null,
    contactPhone: input.contactPhone?.trim() || null,
    website: input.website?.trim() || null,
    discountBps: input.discountBps,
    displayCurrency: input.displayCurrency,
    ...(input.brandColor ? { brandColor: input.brandColor } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    notes: input.notes?.trim() || null,
    isActive: input.isActive ?? true,
    sortOrder: input.sortOrder ?? 0,
    createdById: actor.id,
  })

  await recordAudit({
    entityType: 'Partner', entityId: id, action: 'CREATE', actorId: actor.id,
    summary: `${input.name.trim()} added at ${input.discountBps / 100}% off`,
  })
  return id
}

export async function updatePartner(
  id: string,
  input: PartnerInput,
  actor: SessionUser,
): Promise<void> {
  assertRate(input.discountBps)
  const before = await getPartner(id)
  const slug = slugify(input.name)
  if (!slug) throw new ValidationError('That name cannot be used.', { name: 'Give the company a name.' })
  await assertNameFree(slug, id)

  await db.update(partners).set({
    name: input.name.trim(),
    slug,
    displayName: input.displayName?.trim() || null,
    contactName: input.contactName?.trim() || null,
    contactEmail: input.contactEmail?.trim() || null,
    contactPhone: input.contactPhone?.trim() || null,
    website: input.website?.trim() || null,
    discountBps: input.discountBps,
    displayCurrency: input.displayCurrency,
    ...(input.brandColor ? { brandColor: input.brandColor } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    notes: input.notes?.trim() || null,
    isActive: input.isActive ?? true,
    sortOrder: input.sortOrder ?? 0,
    updatedAt: new Date(),
  }).where(eq(partners.id, id))

  /*
   * The rate is named in the audit, from and to.
   *
   * Everything else here is contact detail somebody can see is wrong. A rate
   * decides what a company pays, and "the partner was edited" does not say
   * whose margin moved or by how much.
   */
  const changes = before.discountBps !== input.discountBps
    ? { discountBps: { from: before.discountBps, to: input.discountBps } }
    : undefined

  await recordAudit({
    entityType: 'Partner', entityId: id, action: 'UPDATE', actorId: actor.id,
    summary: changes
      ? `${input.name.trim()} moved from ${before.discountBps / 100}% to ${input.discountBps / 100}% off`
      : `${input.name.trim()} updated`,
    changes,
  })
}

/**
 * Soft, like every other register here.
 *
 * A partner will own orders and campaigns before long, and a hard delete
 * would take the history of what they bought with it. Removing one frees the
 * name, so a company coming back under new terms starts clean.
 */
export async function deletePartner(id: string, actor: SessionUser): Promise<void> {
  const before = await getPartner(id)
  await db.update(partners)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(eq(partners.id, id))
  await recordAudit({
    entityType: 'Partner', entityId: id, action: 'DELETE', actorId: actor.id,
    summary: `${before.name} removed`,
  })
}
