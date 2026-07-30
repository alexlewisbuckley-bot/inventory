import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import type { Role } from '@/lib/enums'
import { can } from '@/lib/permissions'

/**
 * Federated search across everything the business has a record of.
 *
 * V1 searched watches. That is the fault the audit called C-3 and the reason
 * the navigation rail has thirteen items: if the only thing you can find by
 * typing is a watch, every other object needs a link on the page. Make search
 * answer for six object types and the rail can be five.
 *
 * One input, no modes. What was typed decides what comes back — a run of
 * digits is a phone number or a stock number, `INV-` is an invoice, a leading
 * `>` is an action. A mode switch is a thing to remember, and the whole point
 * of a palette is that there is nothing to remember.
 *
 * Ranking is deliberately not "best textual match". It is: exact identifier
 * first, then most recently touched, then everything else. People in this
 * business return to the same twenty records for a fortnight, so recency beats
 * relevance nearly every time, and a palette that puts a perfect string match
 * on a watch sold in 2023 above the deal you edited an hour ago feels broken
 * even though it is technically correct.
 */

export type SearchKind = 'watch' | 'contact' | 'supplier' | 'deal' | 'sale' | 'task'

export interface SearchHit {
  kind: SearchKind
  id: string
  /** What to show first — the name of the thing. */
  title: string
  /**
   * The one fact that disambiguates it.
   *
   * Never decoration: two watches can share a reference, so a watch shows its
   * serial; two people can share a surname, so a contact shows their company.
   * A row that cannot be told apart from the row above it has not answered.
   */
  subtitle: string
  /** Right-aligned: money, a stage, a status. */
  meta: string | null
  href: string
  /** True when the query matched an identifier exactly. Ranked to the top. */
  exact: boolean
  updatedAt: Date
}

export interface SearchResults {
  hits: SearchHit[]
  /** Milliseconds the database spent. Surfaced so the 100ms budget is testable. */
  tookMs: number
}

const PER_KIND = 5

/** Digits only. `+44 (0)7700 900-123` and `07700900123` have to be one query. */
const digitsOf = (value: string) => value.replace(/\D/g, '')

export async function search(
  raw: string,
  role: Role,
  limit = 18,
): Promise<SearchResults> {
  const query = raw.trim()
  if (query.length < 2) return { hits: [], tookMs: 0 }

  const started = Date.now()
  const like = `%${query}%`
  const digits = digitsOf(query)
  // Three digits is the shortest run worth treating as a number rather than as
  // an accident — below that, "44" matches most of the book.
  const numeric = digits.length >= 3 ? `%${digits}%` : null

  const jobs: Array<Promise<SearchHit[]>> = []

  if (can(role, 'watch:read')) jobs.push(watchHits(like, numeric, query, can(role, 'revenue:read')))
  if (can(role, 'customer:read')) jobs.push(contactHits(like, numeric, query))
  if (can(role, 'supplier:read')) jobs.push(supplierHits(like, numeric))
  if (can(role, 'deal:read')) jobs.push(dealHits(like, query))
  if (can(role, 'sale:read')) jobs.push(saleHits(like, query))
  if (can(role, 'task:read')) jobs.push(taskHits(like))

  const found = (await Promise.all(jobs)).flat()

  // Exact identifier, then recency. Stable across ties so the list does not
  // reshuffle between keystrokes, which is what makes a palette feel jumpy.
  found.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1
    return b.updatedAt.getTime() - a.updatedAt.getTime()
  })

  return { hits: found.slice(0, limit), tookMs: Date.now() - started }
}

async function watchHits(
  like: string,
  numeric: string | null,
  query: string,
  showPrice: boolean,
): Promise<SearchHit[]> {
  const exactStock = /^\d+$/.test(query) ? Number(query) : null

  const rows = await db.execute(sql`
    SELECT w.id,
           w.stock_no,
           w.model,
           w.serial,
           w.nickname,
           w.status,
           w.est_sale_gbp,
           w.updated_at,
           b.name AS brand_name,
           (w.stock_no = ${exactStock}) AS exact
    FROM watches w
    JOIN brands b ON b.id = w.brand_id
    WHERE w.deleted_at IS NULL
      AND (
        w.model ILIKE ${like}
        OR w.serial ILIKE ${like}
        OR w.nickname ILIKE ${like}
        OR b.name ILIKE ${like}
        OR (${numeric}::text IS NOT NULL AND w.stock_no::text ILIKE ${numeric})
      )
    ORDER BY exact DESC NULLS LAST, w.updated_at DESC
    LIMIT ${PER_KIND}
  `)

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    kind: 'watch' as const,
    id: String(row.id),
    title: `${row.brand_name} ${row.model}`,
    // The serial is what separates two of the same reference. Without it a
    // list of three identical Daytonas is a list you cannot choose from.
    subtitle: [
      `Stock ${row.stock_no}`,
      row.serial ? `serial ${row.serial}` : 'no serial',
      row.nickname,
    ].filter(Boolean).join(' · '),
    meta: !showPrice ? null : row.est_sale_gbp === null ? 'unpriced' : gbp(Number(row.est_sale_gbp)),
    href: `/inventory/${row.id}`,
    exact: row.exact === true,
    updatedAt: new Date(row.updated_at as string),
  }))
}

async function contactHits(like: string, numeric: string | null, query: string): Promise<SearchHit[]> {
  const rows = await db.execute(sql`
    SELECT c.id, c.reference, c.first_name, c.last_name, c.company, c.email,
           c.phone, c.customer_type, c.tier, c.updated_at,
           (upper(c.reference) = upper(${query})) AS exact
    FROM customers c
    WHERE c.deleted_at IS NULL
      AND (
        c.first_name ILIKE ${like}
        OR c.last_name ILIKE ${like}
        OR (c.first_name || ' ' || c.last_name) ILIKE ${like}
        OR c.company ILIKE ${like}
        OR c.email ILIKE ${like}
        OR c.reference ILIKE ${like}
        OR (${numeric}::text IS NOT NULL
            AND regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') ILIKE ${numeric})
        OR (${numeric}::text IS NOT NULL
            AND regexp_replace(coalesce(c.alt_phone, ''), '[^0-9]', '', 'g') ILIKE ${numeric})
      )
    ORDER BY exact DESC NULLS LAST, c.updated_at DESC
    LIMIT ${PER_KIND}
  `)

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    kind: 'contact' as const,
    id: String(row.id),
    title: `${row.first_name} ${row.last_name}`.trim(),
    subtitle: [row.company, row.email, row.phone].filter(Boolean).join(' · ')
      || String(row.reference),
    meta: row.customer_type === 'TRADE' ? 'Trade' : 'Retail',
    href: `/customers/${row.id}`,
    exact: row.exact === true,
    updatedAt: new Date(row.updated_at as string),
  }))
}

async function supplierHits(like: string, numeric: string | null): Promise<SearchHit[]> {
  const rows = await db.execute(sql`
    SELECT s.id, s.name, s.contact_name, s.email, s.phone, s.country, s.updated_at
    FROM suppliers s
    WHERE s.deleted_at IS NULL
      AND (
        s.name ILIKE ${like}
        OR s.contact_name ILIKE ${like}
        OR s.email ILIKE ${like}
        OR (${numeric}::text IS NOT NULL
            AND regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g') ILIKE ${numeric})
      )
    ORDER BY s.updated_at DESC
    LIMIT ${PER_KIND}
  `)

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    kind: 'supplier' as const,
    id: String(row.id),
    title: String(row.name),
    subtitle: [row.contact_name, row.country, row.email].filter(Boolean).join(' · ')
      || 'Supplier',
    meta: 'Supplier',
    href: `/suppliers?supplier=${row.id}`,
    exact: false,
    updatedAt: new Date(row.updated_at as string),
  }))
}

async function dealHits(like: string, query: string): Promise<SearchHit[]> {
  const rows = await db.execute(sql`
    SELECT d.id, d.reference, d.title, d.stage, d.value_gbp, d.updated_at,
           nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') AS customer_name,
           (upper(d.reference) = upper(${query})) AS exact
    FROM deals d
    LEFT JOIN customers c ON c.id = d.customer_id
    WHERE d.deleted_at IS NULL
      AND (d.title ILIKE ${like} OR d.reference ILIKE ${like})
    ORDER BY exact DESC NULLS LAST, d.updated_at DESC
    LIMIT ${PER_KIND}
  `)

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    kind: 'deal' as const,
    id: String(row.id),
    title: String(row.title),
    subtitle: [row.customer_name, row.reference].filter(Boolean).join(' · '),
    meta: row.value_gbp === null ? null : gbp(Number(row.value_gbp)),
    href: `/pipeline/${row.id}`,
    exact: row.exact === true,
    updatedAt: new Date(row.updated_at as string),
  }))
}

async function saleHits(like: string, query: string): Promise<SearchHit[]> {
  const rows = await db.execute(sql`
    SELECT s.id, s.invoice_no, s.sale_amount_gbp, s.sale_date, s.updated_at, s.watch_id,
           b.name AS brand_name, w.model, w.stock_no,
           (upper(s.invoice_no) = upper(${query})) AS exact
    FROM sales s
    JOIN watches w ON w.id = s.watch_id
    JOIN brands b ON b.id = w.brand_id
    WHERE s.deleted_at IS NULL AND s.voided_at IS NULL
      AND (s.invoice_no ILIKE ${like} OR s.customer_name ILIKE ${like} OR s.customer_company ILIKE ${like})
    ORDER BY exact DESC NULLS LAST, s.updated_at DESC
    LIMIT ${PER_KIND}
  `)

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    kind: 'sale' as const,
    id: String(row.id),
    title: String(row.invoice_no),
    subtitle: `${row.brand_name} ${row.model} · stock ${row.stock_no}`,
    meta: gbp(Number(row.sale_amount_gbp)),
    href: `/sales?invoice=${row.invoice_no}`,
    exact: row.exact === true,
    updatedAt: new Date(row.updated_at as string),
  }))
}

async function taskHits(like: string): Promise<SearchHit[]> {
  const rows = await db.execute(sql`
    SELECT t.id, t.title, t.due_at, t.status, t.updated_at,
           nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') AS customer_name
    FROM tasks t
    LEFT JOIN customers c ON c.id = t.customer_id
    WHERE t.deleted_at IS NULL AND t.status = 'OPEN'
      AND t.title ILIKE ${like}
    ORDER BY t.updated_at DESC
    LIMIT ${PER_KIND}
  `)

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    kind: 'task' as const,
    id: String(row.id),
    title: String(row.title),
    subtitle: [row.customer_name, row.due_at ? 'has a date' : 'no date']
      .filter(Boolean).join(' · '),
    meta: 'Open',
    href: '/tasks',
    exact: false,
    updatedAt: new Date(row.updated_at as string),
  }))
}

/**
 * A short money string for a result row.
 *
 * Deliberately not the currency-aware formatter: the palette is a list of
 * twenty rows read in half a second, and converting each one through the FX
 * table would put a round trip inside the 100ms budget for no gain. Everything
 * here is the base currency and says so by carrying its symbol.
 */
function gbp(minor: number): string {
  return `£${Math.round(minor / 100).toLocaleString('en-GB')}`
}

// ---------------------------------------------------------------------------
// Peek
// ---------------------------------------------------------------------------

export interface PeekRecord {
  kind: SearchKind
  id: string
  title: string
  subtitle: string
  href: string
  facts: Array<{ label: string; value: string }>
  /** The last few things that happened, newest first. */
  recent: Array<{ label: string; at: Date }>
}

/**
 * Enough of a record to answer the phone without leaving what you were doing.
 *
 * Identity, the four facts somebody asks for, and the last three things that
 * happened. Not the record — the point of a peek is that it is quicker to
 * dismiss than the record is to load, and a peek that shows everything is just
 * a slower navigation.
 */
export async function peek(kind: SearchKind, id: string): Promise<PeekRecord | null> {
  if (kind === 'watch') return peekWatch(id)
  if (kind === 'contact') return peekContact(id)
  if (kind === 'deal') return peekDeal(id)
  return null
}

async function peekWatch(id: string): Promise<PeekRecord | null> {
  const rows = await db.execute(sql`
    SELECT w.id, w.stock_no, w.model, w.serial, w.status, w.condition,
           w.purchase_price_gbp, w.est_sale_gbp, w.purchase_date,
           b.name AS brand_name, l.name AS location_name, s.name AS supplier_name
    FROM watches w
    JOIN brands b ON b.id = w.brand_id
    LEFT JOIN locations l ON l.id = w.location_id
    LEFT JOIN suppliers s ON s.id = w.supplier_id
    WHERE w.id = ${id} AND w.deleted_at IS NULL
    LIMIT 1
  `)
  const row = (rows as unknown as Record<string, unknown>[])[0]
  if (!row) return null

  const margin = row.est_sale_gbp !== null && row.purchase_price_gbp !== null
    ? Number(row.est_sale_gbp) - Number(row.purchase_price_gbp)
    : null

  return {
    kind: 'watch',
    id: String(row.id),
    title: `${row.brand_name} ${row.model}`,
    subtitle: `Stock ${row.stock_no}${row.serial ? ` · serial ${row.serial}` : ''}`,
    href: `/inventory/${row.id}`,
    facts: [
      { label: 'Status', value: String(row.status).replace('_', ' ').toLowerCase() },
      { label: 'Where', value: String(row.location_name ?? 'not recorded') },
      { label: 'Cost', value: gbp(Number(row.purchase_price_gbp ?? 0)) },
      {
        label: 'Asking',
        value: row.est_sale_gbp === null ? 'not priced' : gbp(Number(row.est_sale_gbp)),
      },
      {
        label: 'Margin',
        value: margin === null ? '—' : `${margin >= 0 ? '+' : '−'}${gbp(Math.abs(margin))}`,
      },
      { label: 'From', value: String(row.supplier_name ?? 'unknown') },
    ],
    recent: await recentActivity(sql`watch_id = ${id}`),
  }
}

async function peekContact(id: string): Promise<PeekRecord | null> {
  const rows = await db.execute(sql`
    SELECT c.id, c.reference, c.first_name, c.last_name, c.company, c.email, c.phone,
           c.customer_type, c.tier, c.status, c.last_contacted_at,
           (SELECT count(*) FROM sales
             WHERE sales.customer_id = c.id AND sales.voided_at IS NULL AND sales.deleted_at IS NULL) AS bought,
           (SELECT coalesce(sum(sale_amount_gbp), 0) FROM sales
             WHERE sales.customer_id = c.id AND sales.voided_at IS NULL AND sales.deleted_at IS NULL) AS lifetime,
           (SELECT count(*) FROM deals
             WHERE deals.customer_id = c.id AND deals.deleted_at IS NULL
               AND deals.stage NOT IN ('WON', 'LOST')) AS open_deals
    FROM customers c
    WHERE c.id = ${id} AND c.deleted_at IS NULL
    LIMIT 1
  `)
  const row = (rows as unknown as Record<string, unknown>[])[0]
  if (!row) return null

  return {
    kind: 'contact',
    id: String(row.id),
    title: `${row.first_name} ${row.last_name}`.trim(),
    subtitle: [row.company, row.email, row.phone].filter(Boolean).join(' · ')
      || String(row.reference),
    href: `/customers/${row.id}`,
    facts: [
      { label: 'Side', value: row.customer_type === 'TRADE' ? 'Trade' : 'Retail' },
      { label: 'Tier', value: String(row.tier).toLowerCase() },
      { label: 'Bought', value: String(row.bought) },
      { label: 'Lifetime', value: gbp(Number(row.lifetime)) },
      { label: 'Open deals', value: String(row.open_deals) },
      {
        label: 'Last spoken to',
        value: row.last_contacted_at
          ? new Date(row.last_contacted_at as string).toLocaleDateString('en-GB')
          : 'never',
      },
    ],
    recent: await recentActivity(sql`customer_id = ${id}`),
  }
}

async function peekDeal(id: string): Promise<PeekRecord | null> {
  const rows = await db.execute(sql`
    SELECT d.id, d.reference, d.title, d.stage, d.value_gbp, d.probability,
           d.expected_close, d.stage_changed_at,
           nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') AS customer_name,
           u.name AS owner_name
    FROM deals d
    LEFT JOIN customers c ON c.id = d.customer_id
    LEFT JOIN users u ON u.id = d.owner_id
    WHERE d.id = ${id} AND d.deleted_at IS NULL
    LIMIT 1
  `)
  const row = (rows as unknown as Record<string, unknown>[])[0]
  if (!row) return null

  return {
    kind: 'deal',
    id: String(row.id),
    title: String(row.title),
    subtitle: [row.customer_name, row.reference].filter(Boolean).join(' · '),
    href: `/pipeline/${row.id}`,
    facts: [
      { label: 'Stage', value: String(row.stage).replace('_', ' ').toLowerCase() },
      { label: 'Value', value: row.value_gbp === null ? '—' : gbp(Number(row.value_gbp)) },
      { label: 'Likelihood', value: `${row.probability}%` },
      { label: 'Owner', value: String(row.owner_name ?? 'nobody') },
      {
        label: 'Closes',
        value: row.expected_close
          ? new Date(row.expected_close as string).toLocaleDateString('en-GB')
          : 'not set',
      },
    ],
    recent: await recentActivity(sql`deal_id = ${id}`),
  }
}

async function recentActivity(where: ReturnType<typeof sql>) {
  const rows = await db.execute(sql`
    SELECT subject, type, occurred_at
    FROM activities
    WHERE ${where}
    ORDER BY occurred_at DESC
    LIMIT 3
  `)
  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    label: String(row.subject ?? row.type),
    at: new Date(row.occurred_at as string),
  }))
}
