import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { brands, watchImages, watches } from '../db/schema'
import { getRateTable } from './fx-service'
import { logger } from '@/lib/logger'
import { ValidationError } from '@/lib/errors'
import {
  descriptionHtmlFor, planSync, priceFor, quantityFor, skuFor, statusFor, titleFor,
  type SyncPlan, type SyncProduct, type SyncWatch,
} from '@/lib/shopify-map'
import type { CurrencyCode } from '@/lib/enums'

/**
 * The storefront, kept in step with the book.
 *
 * One direction only. The inventory system decides what exists, at what price,
 * in what state; Shopify is told. Nothing read from Shopify is ever written
 * back into a watch, which is the rule that keeps this a difference to apply
 * rather than a merge to adjudicate — and it is sound here because the site
 * takes enquiries rather than payments, so there is no sale happening over
 * there that this side does not already know about.
 *
 * Everything that decides *what* to do lives in `shopify-map`, where it can be
 * tested without a token. This file is the part that talks.
 */

const API_VERSION = '2025-01'

interface ShopifyConfig {
  domain: string
  locationId: string
  currency: CurrencyCode
  /** Where Shopify fetches photographs from, which must be reachable publicly. */
  origin: string
}

export function shopifyIsConfigured(): boolean {
  if (!process.env.SHOPIFY_STORE_DOMAIN) return false
  return Boolean(
    process.env.SHOPIFY_ADMIN_TOKEN
    || (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET),
  )
}

/**
 * The access token, fetched rather than pasted.
 *
 * Shopify retired the custom app that handed over a permanent token at the
 * start of 2026. What a store app is given now is a client id and a secret,
 * which are exchanged for a token that expires — so the exchange belongs in
 * the application, where it can be repeated, rather than in somebody's
 * terminal history and then in an environment variable nobody can re-read.
 *
 * Cached in module memory and refreshed a minute before it lapses. A serverless
 * instance that is recycled simply fetches another; the exchange is one request
 * and costs nothing worth optimising.
 */
let cachedToken: { value: string; expiresAt: number } | null = null

async function accessToken(domain: string): Promise<string> {
  const direct = process.env.SHOPIFY_ADMIN_TOKEN
  if (direct) return direct

  const clientId = process.env.SHOPIFY_CLIENT_ID
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new ValidationError('The shop is not connected. Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET.')
  }

  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value

  const response = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `The shop refused the credentials (${response.status}). `
      + `Check the client id and secret, and that the app is installed on ${domain}. ${body.slice(0, 200)}`,
    )
  }

  const payload = await response.json() as { access_token?: string; expires_in?: number }
  if (!payload.access_token) throw new Error('The shop returned no access token.')

  cachedToken = {
    value: payload.access_token,
    // A minute's margin, so a token is never used in the second it lapses.
    expiresAt: Date.now() + Math.max(60, (payload.expires_in ?? 3600) - 60) * 1000,
  }
  return cachedToken.value
}

function config(): ShopifyConfig {
  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const locationId = process.env.SHOPIFY_LOCATION_ID
  if (!domain || !shopifyIsConfigured()) {
    throw new ValidationError(
      'The shop is not connected. Set SHOPIFY_STORE_DOMAIN, and either SHOPIFY_ADMIN_TOKEN '
      + 'or the pair SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET.',
    )
  }
  if (!locationId) {
    throw new ValidationError('No storefront location is set. SHOPIFY_LOCATION_ID names the one stock sits at.')
  }
  return {
    domain,
    locationId,
    currency: (process.env.SHOPIFY_CURRENCY ?? 'AED') as CurrencyCode,
    // Where Shopify will come to collect photographs. Falls back to the
    // platform's own name for the production deployment, so the common case
    // needs no configuring and a preview build does not hand the live store
    // URLs that stop working when the preview is torn down.
    origin: process.env.APP_ORIGIN
      || (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : ''),
  }
}

/**
 * One call to the Admin API.
 *
 * GraphQL answers 200 to a request it has refused, with the refusal in the
 * body, so a transport-level check alone would report every failed push as a
 * success. Both shapes are read: `errors` for a query the server would not
 * run, and `userErrors` for one it ran and declined.
 */
async function admin<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const { domain } = config()
  const token = await accessToken(domain)
  const response = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Shopify answered ${response.status}: ${body.slice(0, 300)}`)
  }

  const payload = await response.json() as { data?: T; errors?: Array<{ message: string }> }
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).join('; '))
  }
  if (!payload.data) throw new Error('Shopify returned no data.')
  return payload.data
}

/** A refusal the server made after agreeing to run the mutation. */
function assertNoUserErrors(errors: Array<{ field?: string[] | null; message: string }> | undefined): void {
  if (!errors?.length) return
  throw new Error(errors.map((e) => `${e.field?.join('.') ?? ''} ${e.message}`.trim()).join('; '))
}

// ---------------------------------------------------------------------------
// Reading the two sides
// ---------------------------------------------------------------------------

/** Every watch the sync has an opinion about. */
export async function syncableWatches(): Promise<SyncWatch[]> {
  const rows = await db
    .select({
      id: watches.id,
      stockNo: watches.stockNo,
      brandName: brands.name,
      model: watches.model,
      nickname: watches.nickname,
      year: watches.year,
      status: watches.status,
      estSaleGbp: watches.estSaleGbp,
      caseSizeMm: watches.caseSizeMm,
      caseMaterial: watches.caseMaterial,
      dial: watches.dial,
      bracelet: watches.bracelet,
      movement: watches.movement,
      waterResistanceM: watches.waterResistanceM,
      condition: watches.condition,
      boxPapers: watches.boxPapers,
      description: watches.description,
      shopifyProductId: watches.shopifyProductId,
      // Photographs of the watch only. A warranty card carries a serial, a
      // date and a dealer's stamp, and the storefront is the last place any of
      // that should appear.
      imageIds: sql<string[]>`coalesce((
        SELECT array_agg(i.id ORDER BY i.sort_order, i.created_at)
        FROM watch_images i WHERE i.watch_id = ${watches.id} AND i.kind = 'WATCH'
      ), ARRAY[]::text[])`,
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .where(isNull(watches.deletedAt))
  return rows
}

/** Every product the store currently has. */
export async function storeProducts(): Promise<SyncProduct[]> {
  const found: SyncProduct[] = []
  let cursor: string | null = null

  // Paged rather than asked for in one go: a store grows, and a sync that
  // silently stops at the first page would start archiving everything past it.
  do {
    const data: {
      products: {
        edges: Array<{ node: {
          id: string
          title: string
          status: string
          variants: { edges: Array<{ node: { sku: string | null } }> }
        } }>
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
    } = await admin(`
      query Products($cursor: String) {
        products(first: 100, after: $cursor) {
          edges { node { id title status variants(first: 1) { edges { node { sku } } } } }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { cursor })

    for (const edge of data.products.edges) {
      found.push({
        id: edge.node.id,
        title: edge.node.title,
        status: edge.node.status,
        sku: edge.node.variants.edges[0]?.node.sku ?? null,
      })
    }
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null
  } while (cursor)

  return found
}

/** What it would take to make the store match the book. */
export async function plan(): Promise<SyncPlan> {
  const [stock, products] = await Promise.all([syncableWatches(), storeProducts()])
  return planSync(stock, products)
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const PRODUCT_SET = `
  mutation Push($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
    productSet(input: $input, identifier: $identifier, synchronous: true) {
      product { id variants(first: 1) { edges { node { id sku } } } }
      userErrors { field message }
    }
  }
`

const PRODUCT_DELETE = `
  mutation Remove($input: ProductDeleteInput!) {
    productDelete(input: $input) { deletedProductId userErrors { field message } }
  }
`

/**
 * One watch, pushed.
 *
 * `productSet` is an upsert keyed on the SKU, which means this does not need
 * to know whether the product already exists — and more usefully, that a
 * product somebody made by hand with the right stock number is adopted rather
 * than duplicated.
 */
export async function pushWatch(watch: SyncWatch, rates: Record<string, number>): Promise<string> {
  const { currency, locationId, origin } = config()
  const sku = skuFor(watch.stockNo)
  const price = priceFor(watch.estSaleGbp, currency, rates)

  const files = origin
    ? watch.imageIds.map((id) => ({
      originalSource: `${origin}/api/storefront-image/${id}`,
      contentType: 'IMAGE' as const,
      alt: titleFor(watch),
    }))
    : []

  const data = await admin<{
    productSet: {
      product: { id: string } | null
      userErrors: Array<{ field?: string[] | null; message: string }>
    }
  }>(PRODUCT_SET, {
    // Exactly one field, or none. `ProductSetIdentifiers` is a oneOf input and
    // rejects a payload naming the others as null — which looks like a tidy
    // way to write "no handle, no custom id" and fails every single call.
    ...(watch.shopifyProductId ? { identifier: { id: watch.shopifyProductId } } : {}),
    input: {
      title: titleFor(watch),
      descriptionHtml: descriptionHtmlFor(watch),
      status: statusFor(watch),
      vendor: watch.brandName,
      productType: 'Watch',
      ...(files.length ? { files } : {}),
      productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
      variants: [{
        sku,
        ...(price ? { price } : {}),
        optionValues: [{ optionName: 'Title', name: 'Default Title' }],
        inventoryItem: { sku, tracked: true },
        inventoryQuantities: [{
          locationId,
          name: 'available',
          quantity: quantityFor(watch),
        }],
      }],
    },
  })

  assertNoUserErrors(data.productSet.userErrors)
  const id = data.productSet.product?.id
  if (!id) throw new Error('Shopify accepted the product but returned no id.')
  return id
}

/** A product with no watch behind it, removed outright. */
export async function removeProduct(productId: string): Promise<void> {
  const data = await admin<{
    productDelete: { userErrors: Array<{ field?: string[] | null; message: string }> }
  }>(PRODUCT_DELETE, { input: { id: productId } })
  assertNoUserErrors(data.productDelete.userErrors)
}

/** A product whose watch has left the book: hidden, not destroyed. */
export async function archiveProduct(productId: string): Promise<void> {
  const data = await admin<{
    productUpdate: { userErrors: Array<{ field?: string[] | null; message: string }> }
  }>(`
    mutation Archive($product: ProductUpdateInput!) {
      productUpdate(product: $product) { product { id } userErrors { field message } }
    }
  `, { product: { id: productId, status: 'ARCHIVED' } })
  assertNoUserErrors(data.productUpdate.userErrors)
}

export interface SyncOutcome {
  created: number
  updated: number
  archived: number
  removed: number
  failed: Array<{ what: string; error: string }>
}

/**
 * Make the store match the book.
 *
 * Deliberately not atomic, and it could not be: there is no transaction
 * spanning a database and somebody else's API. So each item is applied on its
 * own and a failure is recorded against that item rather than abandoning the
 * run — nineteen watches correctly listed and one failure named is a better
 * outcome than twenty left as they were.
 *
 * `apply` is false by default. The destructive half of this plan deletes live
 * product pages, and the shape of that should be read by a person before it
 * happens.
 */
export async function runSync({ apply = false }: { apply?: boolean } = {}): Promise<{
  plan: SyncPlan
  outcome: SyncOutcome | null
}> {
  const computed = await plan()
  if (!apply) return { plan: computed, outcome: null }

  const rates = await getRateTable()
  const outcome: SyncOutcome = { created: 0, updated: 0, archived: 0, removed: 0, failed: [] }

  const pushes: Array<{ watch: SyncWatch; productId: string | null }> = [
    ...computed.create.map((watch) => ({ watch, productId: null })),
    ...computed.update.map((u) => ({ watch: u.watch, productId: u.productId })),
  ]

  for (const { watch, productId: existing } of pushes) {
    try {
      // The plan's product id wins over the one cached on the row: the plan
      // was built from what the store has now, and the cache may be pointing
      // at a page somebody deleted by hand.
      const productId = await pushWatch({ ...watch, shopifyProductId: existing }, rates)
      await db.update(watches)
        .set({ shopifyProductId: productId, shopifySyncedAt: new Date(), shopifyError: null })
        .where(eq(watches.id, watch.id))
      if (existing) outcome.updated += 1
      else outcome.created += 1
    } catch (error) {
      const message = (error as Error).message.slice(0, 500)
      await db.update(watches).set({ shopifyError: message }).where(eq(watches.id, watch.id))
      outcome.failed.push({ what: `Stock ${watch.stockNo}`, error: message })
    }
  }

  for (const item of computed.archive) {
    try {
      await archiveProduct(item.productId)
      outcome.archived += 1
    } catch (error) {
      outcome.failed.push({ what: item.title, error: (error as Error).message.slice(0, 500) })
    }
  }

  for (const item of computed.remove) {
    try {
      await removeProduct(item.productId)
      outcome.removed += 1
    } catch (error) {
      outcome.failed.push({ what: item.title, error: (error as Error).message.slice(0, 500) })
    }
  }

  logger.info('storefront synced', { ...outcome, failed: outcome.failed.length })
  return { plan: computed, outcome }
}

/**
 * One watch, pushed as soon as it changes.
 *
 * Called from the mutations rather than from a schedule, because the point of
 * this is that marking a watch sold takes it off the website — and "within the
 * hour" is not that. It never throws: a storefront that cannot be reached must
 * not stop a sale being recorded, so the failure is written to the row and the
 * next reconcile picks it up.
 */
export async function pushWatchById(watchId: string): Promise<void> {
  if (!shopifyIsConfigured()) return
  try {
    const [row] = await db.select({ id: watches.id }).from(watches)
      .where(and(eq(watches.id, watchId), isNull(watches.deletedAt))).limit(1)
    if (!row) return

    const all = await syncableWatches()
    const watch = all.find((w) => w.id === watchId)
    if (!watch) return

    const rates = await getRateTable()
    const productId = await pushWatch(watch, rates)
    await db.update(watches)
      .set({ shopifyProductId: productId, shopifySyncedAt: new Date(), shopifyError: null })
      .where(eq(watches.id, watchId))
  } catch (error) {
    const message = (error as Error).message.slice(0, 500)
    logger.warn('storefront push failed', { watchId, error: message })
    await db.update(watches).set({ shopifyError: message })
      .where(eq(watches.id, watchId)).catch(() => undefined)
  }
}

/** Which watches the storefront is currently out of step with. */
export async function syncHealth(): Promise<{
  configured: boolean
  listed: number
  failing: number
  lastSyncedAt: Date | null
}> {
  const rows = await db
    .select({
      listed: sql<number>`count(*) filter (where ${watches.shopifyProductId} is not null)`,
      failing: sql<number>`count(*) filter (where ${watches.shopifyError} is not null)`,
      lastSyncedAt: sql<Date | null>`max(${watches.shopifySyncedAt})`,
    })
    .from(watches)
    .where(isNull(watches.deletedAt))
  const row = rows[0]
  return {
    configured: shopifyIsConfigured(),
    listed: Number(row?.listed ?? 0),
    failing: Number(row?.failing ?? 0),
    lastSyncedAt: row?.lastSyncedAt ?? null,
  }
}

/** Forget the storefront's ids, so the next sync re-matches from scratch. */
export async function forgetLinks(watchIds?: string[]): Promise<void> {
  await db.update(watches)
    .set({ shopifyProductId: null, shopifySyncedAt: null, shopifyError: null })
    .where(watchIds?.length ? inArray(watches.id, watchIds) : sql`true`)
  await db.update(watchImages).set({ shopifyMediaId: null }).where(sql`true`)
}
