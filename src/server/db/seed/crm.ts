import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../client'
import {
  activities, brands, customers, customerBrands, deals, dealStageEvents,
  offers, sales, tasks, users, watches, watchRequests,
} from '../schema'
import { newId } from '@/lib/ids'
import { DEAL_STAGE_PROBABILITY, type DealStage } from '@/lib/enums'

/**
 * A believable customer book.
 *
 * An empty CRM cannot be evaluated: every screen looks correct when there is
 * nothing on it. This seeds a book with the shape a real one has — a few
 * customers who buy repeatedly, more who bought once, a pipeline weighted
 * towards its early stages, and follow-ups both due and overdue.
 *
 * Idempotent: it does nothing if customers already exist, so running the seed
 * twice does not double the book.
 */

const CUSTOMERS = [
  {
    firstName: 'Faisal', lastName: 'Al Mansoori', company: 'Mansoori Holdings',
    email: 'faisal@mansooriholdings.ae', phone: '+971 50 123 4567',
    country: 'United Arab Emirates', city: 'Dubai',
    tier: 'VIP' as const, leadSource: 'REFERRAL' as const, channel: 'WHATSAPP' as const,
    budget: [4_000_000, 15_000_000] as const,
    birthday: '1979-03-14',
    notes: 'Collects Daytonas. Prefers full sets and will wait for the right dial. Deals in AED.',
    brands: ['Rolex'],
  },
  {
    firstName: 'Charlotte', lastName: 'Whitmore', company: null,
    email: 'charlotte.whitmore@gmail.com', phone: '+44 7700 900142',
    country: 'United Kingdom', city: 'London',
    tier: 'PRIORITY' as const, leadSource: 'INSTAGRAM' as const, channel: 'EMAIL' as const,
    budget: [800_000, 2_500_000] as const,
    birthday: '1988-08-02',
    notes: 'Buying her first serious piece. Wants something she can wear every day.',
    brands: ['Rolex'],
  },
  {
    firstName: 'Marcus', lastName: 'Reinhardt', company: 'Reinhardt Zeitmesser',
    email: 'm.reinhardt@zeitmesser.de', phone: '+49 170 5551234',
    country: 'Germany', city: 'Munich',
    tier: 'PRIORITY' as const, leadSource: 'TRADE' as const, channel: 'PHONE' as const,
    type: 'TRADE' as const,
    budget: [1_000_000, 8_000_000] as const,
    birthday: '1971-11-27',
    notes: 'Trade buyer. Takes two or three a quarter, always wants the trade price first.',
    brands: ['Rolex'],
  },
  {
    firstName: 'Priya', lastName: 'Raman', company: null,
    email: 'priya.raman@outlook.com', phone: '+44 7700 900318',
    country: 'United Kingdom', city: 'Manchester',
    tier: 'STANDARD' as const, leadSource: 'WEBSITE' as const, channel: 'EMAIL' as const,
    budget: [500_000, 1_200_000] as const,
    birthday: '1993-06-19',
    notes: 'Enquired about a Datejust for an anniversary in the autumn.',
    brands: ['Rolex'],
  },
  {
    firstName: 'Tom', lastName: 'Beckley', company: 'Beckley & Sons',
    email: 'tom@beckleyandsons.co.uk', phone: '+44 7700 900555',
    country: 'United Kingdom', city: 'Birmingham',
    tier: 'STANDARD' as const, leadSource: 'WALK_IN' as const, channel: 'PHONE' as const,
    budget: [300_000, 900_000] as const,
    birthday: '1965-01-08',
    notes: 'Slow to decide but always follows through. Ring rather than email.',
    brands: [],
  },
  {
    firstName: 'Sofia', lastName: 'Almeida', company: null,
    email: 'sofia.almeida@icloud.com', phone: '+351 912 345 678',
    country: 'Portugal', city: 'Lisbon',
    tier: 'STANDARD' as const, leadSource: 'MARKETPLACE' as const, channel: 'WHATSAPP' as const,
    budget: [600_000, 1_800_000] as const,
    birthday: '1990-09-30',
    notes: 'Found us through a listing. Asked a lot of good questions about provenance.',
    brands: [],
  },
  {
    firstName: 'Henry', lastName: 'Osei', company: 'Osei Capital',
    email: 'h.osei@oseicapital.com', phone: '+44 7700 900771',
    country: 'United Kingdom', city: 'London',
    tier: 'VIP' as const, leadSource: 'REPEAT' as const, channel: 'WHATSAPP' as const,
    budget: [2_000_000, 9_000_000] as const,
    birthday: '1982-04-05',
    notes: 'Four purchases in two years. Wants first refusal on anything green-dialled.',
    brands: ['Rolex'],
  },
  {
    firstName: 'Yuki', lastName: 'Tanaka', company: null,
    email: 'yuki.tanaka@gmail.com', phone: '+81 90 1234 5678',
    country: 'Japan', city: 'Tokyo',
    tier: 'STANDARD' as const, leadSource: 'EVENT' as const, channel: 'EMAIL' as const,
    budget: [900_000, 3_000_000] as const,
    birthday: '1986-12-11',
    notes: 'Met at the Geneva fair. Careful buyer, replies quickly.',
    brands: [],
  },
]

const DEALS: Array<{
  customer: string
  title: string
  stage: DealStage
  valueGbp: number | null
  daysAgo: number
  closeInDays: number | null
  notes?: string
  lostReason?: string
}> = [
  { customer: 'Faisal', title: 'Daytona 126500LN — white dial', stage: 'NEGOTIATION', valueGbp: 3_450_000, daysAgo: 9, closeInDays: 6, notes: 'Wants the sticker still on. Happy at 34.5k if we ship to Dubai.' },
  { customer: 'Henry', title: 'Submariner 126610LV for the collection', stage: 'DEPOSIT_TAKEN', valueGbp: 1_480_000, daysAgo: 14, closeInDays: 3, notes: 'Deposit of £5,000 taken. Balance on collection.' },
  { customer: 'Charlotte', title: 'First Rolex — Datejust 41', stage: 'OFFER_SENT', valueGbp: 1_120_000, daysAgo: 5, closeInDays: 12, notes: 'Sent two options, jubilee and oyster.' },
  { customer: 'Marcus', title: 'Trade lot — three sports models', stage: 'QUALIFIED', valueGbp: 4_200_000, daysAgo: 3, closeInDays: 21, notes: 'Wants trade pricing across the lot.' },
  { customer: 'Priya', title: 'Anniversary Datejust', stage: 'ENQUIRY', valueGbp: 780_000, daysAgo: 1, closeInDays: 40 },
  { customer: 'Sofia', title: 'GMT-Master II enquiry', stage: 'SOURCING', valueGbp: 1_650_000, daysAgo: 11, closeInDays: 25, notes: 'Nothing suitable in stock — asked two suppliers.' },
  { customer: 'Tom', title: 'Oyster Perpetual 41', stage: 'PAYMENT_PENDING', valueGbp: 620_000, daysAgo: 20, closeInDays: 1, notes: 'Invoice sent, awaiting bank transfer.' },
  { customer: 'Yuki', title: 'Explorer II — polar dial', stage: 'ENQUIRY', valueGbp: 890_000, daysAgo: 2, closeInDays: 30 },
  { customer: 'Charlotte', title: 'Cellini enquiry', stage: 'LOST', valueGbp: 540_000, daysAgo: 60, closeInDays: null, lostReason: 'Bought elsewhere while we were sourcing.' },
]

export async function seedCrm(): Promise<number> {
  const [already] = await db.select({ value: sql<number>`count(*)` }).from(customers)
  if (Number(already?.value ?? 0) > 0) return 0

  const staff = await db.select({ id: users.id, email: users.email })
    .from(users).where(and(eq(users.isActive, true), isNull(users.deletedAt)))
  const owner = staff.find((u) => u.email === 'alex@bluecroft.co.uk')?.id ?? staff[0]?.id
  const seller = staff.find((u) => u.email === 'sarah@bluecroft.co.uk')?.id ?? owner
  if (!owner) return 0

  const brandRows = await db.select({ id: brands.id, name: brands.name }).from(brands)
  const brandByName = new Map(brandRows.map((b) => [b.name, b.id]))

  const stock = await db.select({ id: watches.id, stockNo: watches.stockNo, estSaleGbp: watches.estSaleGbp })
    .from(watches).where(and(isNull(watches.deletedAt), eq(watches.status, 'IN_STOCK')))
    .orderBy(asc(watches.stockNo)).limit(12)

  const ids = new Map<string, string>()
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000)
  const ahead = (days: number) => new Date(Date.now() + days * 86_400_000)

  // --- Customers -----------------------------------------------------------
  let index = 0
  for (const spec of CUSTOMERS) {
    index += 1
    const id = newId('cus')
    ids.set(spec.firstName, id)
    await db.insert(customers).values({
      id,
      reference: `C-${String(index).padStart(4, '0')}`,
      firstName: spec.firstName,
      lastName: spec.lastName,
      company: spec.company,
      email: spec.email,
      phone: spec.phone,
      country: spec.country,
      city: spec.city,
      preferredChannel: spec.channel,
      tier: spec.tier,
      customerType: 'type' in spec ? spec.type : 'RETAIL',
      leadSource: spec.leadSource,
      budgetMinGbp: spec.budget[0],
      budgetMaxGbp: spec.budget[1],
      birthday: spec.birthday,
      notes: spec.notes,
      marketingConsent: index % 3 !== 0,
      consentRecordedAt: index % 3 !== 0 ? ago(120) : null,
      ownerId: index % 2 === 0 ? seller : owner,
      // Two are deliberately stale, so the "quiet VIP" alert has something true
      // to say the first time somebody opens the dashboard.
      lastContactedAt: spec.firstName === 'Henry' ? ago(104)
        : spec.firstName === 'Tom' ? ago(97)
        : ago(index * 3),
      createdAt: ago(200 - index * 12),
    })

    for (const brandName of spec.brands) {
      const brandId = brandByName.get(brandName)
      if (brandId) await db.insert(customerBrands).values({ customerId: id, brandId }).onConflictDoNothing()
    }

    await db.insert(activities).values({
      id: newId('act'), type: 'SYSTEM', subject: 'Customer created', isSystem: true,
      customerId: id, actorId: owner, occurredAt: ago(200 - index * 12),
    })
  }

  // --- Conversations -------------------------------------------------------
  const conversations: Array<[string, 'CALL' | 'EMAIL' | 'WHATSAPP' | 'MEETING' | 'NOTE', string, string, number]> = [
    ['Faisal', 'WHATSAPP', 'Daytona availability', 'Asked whether the white dial is still here. Sent photographs of the sticker and the card.', 2],
    ['Faisal', 'CALL', 'Price discussion', 'Twenty minutes. Wants 34.5k including shipping to Dubai; said I would check.', 4],
    ['Henry', 'WHATSAPP', 'Green dial first refusal', 'Reminded him we have the 126610LV. He asked us to hold it until Friday.', 14],
    ['Charlotte', 'EMAIL', 'Two options sent', 'Sent the jubilee and the oyster with wrist shots. She is deciding between them.', 5],
    ['Marcus', 'CALL', 'Quarterly buy', 'Wants three sports models as a lot. Asked for trade pricing across all of them.', 3],
    ['Priya', 'EMAIL', 'Datejust enquiry', 'Anniversary in October. Budget around eight thousand, wants something classic.', 1],
    ['Sofia', 'WHATSAPP', 'GMT enquiry', 'Asked about a Pepsi. Nothing suitable in stock; explained we would source.', 11],
    ['Tom', 'CALL', 'Invoice chase', 'Said the transfer goes out on Monday. Ring again if nothing by Wednesday.', 6],
    ['Yuki', 'EMAIL', 'Explorer II', 'Following up from Geneva. Sent the polar dial specification.', 2],
  ]
  for (const [who, type, subject, body, days] of conversations) {
    const customerId = ids.get(who)
    if (!customerId) continue
    await db.insert(activities).values({
      id: newId('act'), type, direction: type === 'NOTE' ? 'INTERNAL' : 'OUTBOUND',
      subject, body, customerId, actorId: owner, occurredAt: ago(days),
      durationMin: type === 'CALL' ? 15 + (days % 4) * 5 : null,
    })
  }

  // --- Pipeline ------------------------------------------------------------
  let dealIndex = 0
  for (const spec of DEALS) {
    dealIndex += 1
    const customerId = ids.get(spec.customer)
    if (!customerId) continue
    const watch = stock[dealIndex % Math.max(stock.length, 1)]
    const id = newId('dea')

    await db.insert(deals).values({
      id,
      reference: `D-${String(dealIndex).padStart(4, '0')}`,
      title: spec.title,
      customerId,
      watchId: spec.stage === 'SOURCING' ? null : watch?.id ?? null,
      stage: spec.stage,
      valueGbp: spec.valueGbp,
      probability: DEAL_STAGE_PROBABILITY[spec.stage],
      expectedClose: spec.closeInDays === null ? null : ahead(spec.closeInDays).toISOString().slice(0, 10),
      ownerId: dealIndex % 2 === 0 ? seller : owner,
      source: 'REFERRAL',
      notes: spec.notes ?? null,
      lostReason: spec.lostReason ?? null,
      closedAt: spec.stage === 'LOST' ? ago(spec.daysAgo - 5) : null,
      stageChangedAt: ago(Math.max(1, spec.daysAgo - 2)),
      sortOrder: dealIndex,
      createdAt: ago(spec.daysAgo),
    })

    await db.insert(dealStageEvents).values({
      id: newId('dse'), dealId: id, fromStage: null, toStage: 'ENQUIRY',
      actorId: owner, createdAt: ago(spec.daysAgo),
    })
    if (spec.stage !== 'ENQUIRY') {
      await db.insert(dealStageEvents).values({
        id: newId('dse'), dealId: id, fromStage: 'ENQUIRY', toStage: spec.stage,
        actorId: owner, createdAt: ago(Math.max(1, spec.daysAgo - 2)),
      })
    }

    if (spec.stage === 'OFFER_SENT' || spec.stage === 'NEGOTIATION') {
      await db.insert(offers).values({
        id: newId('off'), dealId: id, customerId, watchId: watch?.id ?? null,
        amount: spec.valueGbp ?? 0, currency: 'GBP', amountGbp: spec.valueGbp ?? 0,
        status: 'SENT', validUntil: ahead(7).toISOString().slice(0, 10),
        createdBy: owner, createdAt: ago(Math.max(1, spec.daysAgo - 3)),
      })
    }
  }

  // --- Watch requests ------------------------------------------------------
  const requests = [
    { who: 'Sofia', model: 'GMT-Master II', reference: '126710BLRO', budget: 1_650_000, priority: 'HIGH' as const, dial: 'Pepsi bezel', days: 11 },
    { who: 'Yuki', model: 'Explorer II', reference: '226570', budget: 900_000, priority: 'NORMAL' as const, dial: 'Polar white', days: 2 },
    { who: 'Henry', model: 'Submariner', reference: '126610LV', budget: 1_500_000, priority: 'URGENT' as const, dial: 'Green', days: 20 },
    { who: 'Marcus', model: 'Daytona', reference: '116500LN', budget: 3_000_000, priority: 'NORMAL' as const, dial: 'Panda', days: 30 },
  ]
  for (const spec of requests) {
    const customerId = ids.get(spec.who)
    if (!customerId) continue
    await db.insert(watchRequests).values({
      id: newId('req'),
      customerId,
      brandId: brandByName.get('Rolex') ?? null,
      model: spec.model,
      referenceNo: spec.reference,
      dial: spec.dial,
      condition: 'EXCELLENT',
      boxPapers: 'FULL_SET',
      budgetGbp: spec.budget,
      targetDate: ahead(45).toISOString().slice(0, 10),
      priority: spec.priority,
      status: spec.days > 15 ? 'SOURCING' : 'OPEN',
      ownerId: owner,
      createdAt: ago(spec.days),
    })
  }

  // --- Attach the existing ledger to the book -------------------------------
  //
  // Sales seeded before the CRM existed carry a buyer's name and nothing else.
  // Attributing a few of them is what makes lifetime value, repeat-purchase
  // history and "what has this relationship been worth" true rather than
  // theoretical on a fresh install.
  const ledger = await db.select({ id: sales.id })
    .from(sales)
    .where(and(isNull(sales.deletedAt), isNull(sales.voidedAt)))
    .orderBy(asc(sales.saleDate))
    .limit(6)

  const buyers = ['Henry', 'Faisal', 'Henry', 'Marcus', 'Charlotte', 'Henry']
  for (const [position, sale] of ledger.entries()) {
    const customerId = ids.get(buyers[position] ?? 'Henry')
    if (!customerId) continue
    await db.update(sales).set({ customerId }).where(eq(sales.id, sale.id))
    await db.insert(activities).values({
      id: newId('act'), type: 'SALE', subject: 'Bought a watch', isSystem: true,
      customerId, actorId: owner, occurredAt: ago(60 + position * 20),
    })
  }

  // --- Follow-ups ----------------------------------------------------------
  const followUps: Array<[string, string, 'CALL' | 'EMAIL' | 'FOLLOW_UP' | 'ADMIN', number, 'HIGH' | 'NORMAL' | 'URGENT']> = [
    ['Faisal', 'Come back on the Dubai shipping price', 'CALL', -1, 'URGENT'],
    ['Tom', 'Chase the bank transfer', 'CALL', 0, 'HIGH'],
    ['Charlotte', 'Follow up on the two options sent', 'EMAIL', 1, 'NORMAL'],
    ['Priya', 'Send Datejust options within budget', 'EMAIL', 2, 'NORMAL'],
    ['Henry', 'Confirm collection date for the 126610LV', 'CALL', 3, 'HIGH'],
    ['Marcus', 'Put together trade pricing for the lot', 'ADMIN', -3, 'HIGH'],
    ['Sofia', 'Update her on the sourcing attempts', 'FOLLOW_UP', 5, 'NORMAL'],
  ]
  for (const [who, title, kind, dueInDays, priority] of followUps) {
    const customerId = ids.get(who)
    if (!customerId) continue
    await db.insert(tasks).values({
      id: newId('tsk'),
      title,
      kind,
      priority,
      dueAt: dueInDays >= 0 ? ahead(dueInDays) : ago(-dueInDays),
      assigneeId: owner,
      customerId,
      createdBy: owner,
    })
  }

  return CUSTOMERS.length
}
