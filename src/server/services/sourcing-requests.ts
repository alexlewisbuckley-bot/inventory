/**
 * Asks that come from outside: a partner, or one of their agents.
 *
 * Alex: "a sourcing request CTA that is easily visable for agents and
 * procurers in case we don't have the exact watch or item they are looking
 * for."
 *
 * These land on the same Wanted board as everything else. The alternative —
 * an inbox of its own for portal asks — is two lists of what we are looking
 * for, and the second one is the one nobody opens.
 *
 * Nothing here takes a `SessionUser`, because nobody here is one: the door is
 * a link, and the writes it carries are deliberately the smallest they can
 * be. An ask is raised OPEN, unowned and at normal priority. Who picks it up,
 * what it is worth chasing and what we pay for it are ours to decide, and a
 * form on a partner's phone should not be able to say otherwise.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { brands, partnerAgents, partners, watchRequests } from '../db/schema'
import { newId } from '@/lib/ids'
import { ValidationError } from '@/lib/errors'
import { logger } from '@/lib/logger'

export interface AskInput {
  /** What they are after, in their own words — the one thing we insist on. */
  wanted: string
  /** And anything else they know: a reference, a budget, when they need it. */
  referenceNo?: string | null
  budgetBase?: number | null
  notes?: string | null
  /** Who typed it, where the door belongs to a company rather than a person. */
  askedByName?: string | null
}

/** The most we will take from a form somebody can fill in from a phone. */
const MAX_TEXT = 2_000

function clean(value: string | null | undefined, limit = MAX_TEXT): string | null {
  const text = value?.trim()
  if (!text) return null
  return text.slice(0, limit)
}

/**
 * Match the typed words against the brands we know.
 *
 * So "Looking for a Rolex Daytona, white dial" arrives on the board filed
 * under Rolex rather than as loose text — which is what makes the board
 * sortable and what lets the matching query find it stock we already hold.
 * No match is fine: the words are kept whole either way.
 */
export function pickBrand(wanted: string, known: Array<{ id: string; name: string }>): string | null {
  const haystack = wanted.toLowerCase()
  // Longest name first, so "Audemars Piguet" wins over a brand called "AP".
  const sorted = [...known].sort((a, b) => b.name.length - a.name.length)
  return sorted.find((brand) => brand.name && haystack.includes(brand.name.toLowerCase()))?.id ?? null
}

async function brandFrom(wanted: string): Promise<string | null> {
  return pickBrand(wanted, await db.select({ id: brands.id, name: brands.name }).from(brands))
}

async function raise(input: AskInput & {
  partnerId: string
  partnerAgentId: string | null
}): Promise<string> {
  const wanted = clean(input.wanted, 300)
  if (!wanted) throw new ValidationError('Say what you are looking for.')

  /*
   * Somebody here has to own it, or nobody hears when it turns up.
   *
   * An ask raised from outside has no actor behind it, so `owner_id` was
   * null — and the machinery that tells somebody "a watch just arrived that
   * somebody is waiting for" is written to notify the owner. The result was
   * that asks from the portal, the ones we have least other contact about,
   * were the only ones nobody was told about.
   *
   * Whoever set this partner up is the honest default: they are the person
   * who knows them. The board lets anybody hand it on.
   */
  const [partner] = await db
    .select({ ownerId: partners.createdById })
    .from(partners)
    .where(eq(partners.id, input.partnerId))
    .limit(1)

  const id = newId('req')
  await db.insert(watchRequests).values({
    id,
    customerId: null,
    ownerId: partner?.ownerId ?? null,
    partnerId: input.partnerId,
    partnerAgentId: input.partnerAgentId,
    askedByName: clean(input.askedByName, 120),
    brandId: await brandFrom(wanted),
    model: wanted,
    referenceNo: clean(input.referenceNo, 60),
    // Their budget, as given. Nothing here prices anything.
    budgetGbp: input.budgetBase && input.budgetBase > 0 ? input.budgetBase : null,
    notes: clean(input.notes),
    status: 'OPEN',
    priority: 'NORMAL',
  })
  logger.info('sourcing request raised from a portal', { requestId: id, partnerId: input.partnerId })
  return id
}

/** A partner company asks, from inside their portal. */
export async function askFromPortal(partnerId: string, input: AskInput): Promise<string> {
  return raise({ ...input, partnerId, partnerAgentId: null })
}

/** One of their agents asks, from their own link. */
export async function askFromAgent(agentToken: string, input: AskInput): Promise<string> {
  const [agent] = await db
    .select({ id: partnerAgents.id, partnerId: partnerAgents.partnerId, name: partnerAgents.name })
    .from(partnerAgents)
    .innerJoin(partners, eq(partners.id, partnerAgents.partnerId))
    .where(and(
      eq(partnerAgents.token, agentToken),
      eq(partnerAgents.isActive, true),
      isNull(partnerAgents.deletedAt),
      eq(partners.isActive, true),
      isNull(partners.deletedAt),
    ))
    .limit(1)
  if (!agent) throw new ValidationError('That link is not open.')

  return raise({
    ...input,
    partnerId: agent.partnerId,
    partnerAgentId: agent.id,
    // Their own name, from the row — not from the form, where it would be
    // whatever somebody typed.
    askedByName: agent.name,
  })
}

/**
 * What this company has asked us to find, for their own screen.
 *
 * Shown back to them because an ask that disappears is an ask they make again
 * by email next week, and because "we are looking" is the answer to the
 * question the CTA invites.
 */
export async function asksFromPartner(partnerId: string, limit = 20) {
  return db
    .select({
      id: watchRequests.id,
      wanted: watchRequests.model,
      referenceNo: watchRequests.referenceNo,
      status: watchRequests.status,
      askedByName: watchRequests.askedByName,
      agentName: partnerAgents.name,
      createdAt: sql<string>`to_char(${watchRequests.createdAt}, 'YYYY-MM-DD')`,
    })
    .from(watchRequests)
    .leftJoin(partnerAgents, eq(partnerAgents.id, watchRequests.partnerAgentId))
    .where(and(
      eq(watchRequests.partnerId, partnerId),
      isNull(watchRequests.deletedAt),
    ))
    .orderBy(desc(watchRequests.createdAt))
    .limit(limit)
}

/** And what one agent has asked for, for theirs. */
export async function asksFromAgent(agentToken: string, limit = 10) {
  const [agent] = await db
    .select({ id: partnerAgents.id })
    .from(partnerAgents)
    .where(and(
      eq(partnerAgents.token, agentToken),
      isNull(partnerAgents.deletedAt),
    ))
    .limit(1)
  if (!agent) return []

  return db
    .select({
      id: watchRequests.id,
      wanted: watchRequests.model,
      status: watchRequests.status,
      createdAt: sql<string>`to_char(${watchRequests.createdAt}, 'YYYY-MM-DD')`,
    })
    .from(watchRequests)
    .where(and(
      eq(watchRequests.partnerAgentId, agent.id),
      isNull(watchRequests.deletedAt),
    ))
    .orderBy(desc(watchRequests.createdAt))
    .limit(limit)
}
