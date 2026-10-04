import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { brands, locations, watchImages, watches } from '../db/schema'
import { getRateTable } from './fx-service'
import { logger } from '@/lib/logger'
import { ValidationError } from '@/lib/errors'
import {
  descriptionHtmlFor, planSync, priceFor, quantityFor, skuFor, statusFor, titleFor,
  titleIsOurs, type SyncPlan, type SyncProduct, type SyncWatch,
} from '@/lib/shopify-map'
import {
  desiredMetaobjects, indexMetaobjects, isCreatable, METAOBJECT_TYPES, nameFieldFor,
  normalise, resolveMetafields, type MetaobjectIndex,
} from '@/lib/shopify-metafields'
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
      serial: watches.serial,
      nickname: watches.nickname,
      year: watches.year,
      status: watches.status,
      locationName: locations.name,
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
    .leftJoin(locations, eq(locations.id, watches.locationId))
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


/**
 * The shop's own taxonomy, read once.
 *
 * Fetched per run rather than cached between them: these lists are edited by
 * hand in Shopify, and a sync holding a stale copy would silently stop filling
 * in a dial colour somebody added that morning.
 */
export async function loadMetaobjects(): Promise<MetaobjectIndex> {
  const entries: Array<{ type: string; displayName: string; id: string }> = []

  for (const type of METAOBJECT_TYPES) {
    let cursor: string | null = null
    do {
      const data: {
        metaobjects: {
          edges: Array<{ node: { id: string; displayName: string } }>
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
        }
      } = await admin(`
        query Entries($type: String!, $cursor: String) {
          metaobjects(type: $type, first: 100, after: $cursor) {
            edges { node { id displayName } }
            pageInfo { hasNextPage endCursor }
          }
        }
      `, { type, cursor })

      for (const edge of data.metaobjects.edges) {
        entries.push({ type, id: edge.node.id, displayName: edge.node.displayName })
      }
      cursor = data.metaobjects.pageInfo.hasNextPage ? data.metaobjects.pageInfo.endCursor : null
    } while (cursor)
  }

  return indexMetaobjects(entries)
}

/**
 * Add the entries the shop is simply missing.
 *
 * Only for the types where a missing value is a gap rather than a judgement —
 * a year, a case size, a model family. The shop's own wording wins everywhere
 * else: see CREATABLE_TYPES for why inventing a material would split a filter
 * in two rather than complete it.
 *
 * Needs `write_metaobjects`. Without it every create is refused, which is not
 * a failure of the sync: the values are reported as unmatched exactly as they
 * were before, and somebody adds them by hand.
 */
export async function createMissing(
  watches: SyncWatch[],
  index: MetaobjectIndex,
): Promise<{ created: Array<{ type: string; name: string }>; blocked: string | null }> {
  const wanted = new Map<string, { type: string; name: string }>()

  for (const watch of watches) {
    for (const want of desiredMetaobjects(watch)) {
      if (!isCreatable(want)) continue
      if (index.get(want.type)?.has(normalise(want.name))) continue
      // One entry per distinct name, however many watches want it.
      wanted.set(`${want.type}:${normalise(want.name)}`, want)
    }
  }

  const created: Array<{ type: string; name: string }> = []
  let blocked: string | null = null

  for (const want of wanted.values()) {
    try {
      const data = await admin<{
        metaobjectCreate: {
          metaobject: { id: string } | null
          userErrors: Array<{ field?: string[] | null; message: string }>
        }
      }>(`
        mutation Add($metaobject: MetaobjectCreateInput!) {
          metaobjectCreate(metaobject: $metaobject) {
            metaobject { id }
            userErrors { field message }
          }
        }
      `, {
        metaobject: {
          type: want.type,
          fields: [{ key: nameFieldFor(want.type), value: want.name }],
          // Entries the storefront cannot see are entries the filters cannot
          // use, which would look exactly like not having created them.
          capabilities: { publishable: { status: 'ACTIVE' } },
        },
      })

      assertNoUserErrors(data.metaobjectCreate.userErrors)
      const id = data.metaobjectCreate.metaobject?.id
      if (!id) continue

      // Into the index, so the rest of this run finds it.
      const byName = index.get(want.type) ?? new Map<string, string>()
      byName.set(normalise(want.name), id)
      index.set(want.type, byName)
      created.push(want)
    } catch (error) {
      const message = (error as Error).message
      // One refusal is every refusal: it is the same permission each time.
      blocked = message.slice(0, 300)
      break
    }
  }

  return { created, blocked }
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
export async function pushWatch(
  watch: SyncWatch,
  rates: Record<string, number>,
  taxonomy?: MetaobjectIndex,
  /** The title the shop has now, so one somebody wrote is never overwritten. */
  existingTitle?: string,
): Promise<{ productId: string; warning: string | null }> {
  const { currency, locationId, origin } = config()
  const sku = skuFor(watch.stockNo)
  const price = priceFor(watch.estSaleGbp, currency, rates)
  const isNew = !watch.shopifyProductId
  // A title is written when there is none, or when the one there is one this
  // system wrote before it knew the shop's convention. Anything somebody chose
  // is left exactly as they chose it.
  const setTitle = isNew || (existingTitle ? titleIsOurs(existingTitle, watch) : false)

  // Photographs, for a page being created. An existing page's media was very
  // likely arranged by hand — and in this store some of it is shared between
  // products — so a push that re-sent images on every price change would
  // reshuffle a gallery nobody asked it to touch.
  const files = origin && isNew
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
      // Title and description are written ONCE, when the page is created, and
      // never touched again.
      //
      // They are editorial. "Datejust II Fluted 41" is better than "Rolex
      // 116334", and the paragraph underneath it was written to sell the watch
      // — neither is a fact this system holds a better version of. A mirror
      // that overwrites them every time somebody edits a price would quietly
      // undo the shop's own work, which is the surest way to have the sync
      // turned off.
      //
      // What this system does own is stock: the price, the quantity, whether
      // the page should be up at all, and the reference and serial that
      // identify the piece.
      ...(setTitle ? { title: titleFor(watch) } : {}),
      ...(isNew ? {
        descriptionHtml: descriptionHtmlFor(watch),
        vendor: watch.brandName,
        productType: 'Watch',
      } : {}),
      status: statusFor(watch),
      // No metafields here, ever.
      //
      // `productSet` treats the list it is given as the complete set and
      // deletes everything not in it. Sending the two fields this system owns
      // therefore removed the other seventeen — the dial, the material, the
      // location that drives the shop's own filters, the copy somebody wrote —
      // from every product it touched. They go through `metafieldsSet` below,
      // which writes the fields it is given and leaves the rest alone.

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

  await writeMetafields(id, watch, taxonomy)

  // Live means visible. A product that is ACTIVE but attached to no sales
  // channel is in the admin and nowhere else, which looks from the outside
  // exactly like the sync having silently failed.
  //
  // It is also the one step here that can fail without the watch being wrong,
  // so it reports rather than throws.
  const warning = statusFor(watch) === 'ACTIVE'
    ? await publishToOnlineStore(id)
    : null

  return { productId: id, warning }
}

/**
 * What the shop will accept in each field.
 *
 * Several definitions carry a fixed list of choices — `location` takes "Dubai"
 * or "United Kingdom" and nothing else — and a value outside it is refused.
 * Read once per run so the sync can leave a field alone rather than have it
 * rejected, which matters more than it sounds: one bad value failed the whole
 * write, so a location this system could not express cost the watch its dial,
 * its material and its model too.
 */
let cachedChoices: Map<string, string[]> | null = null

async function allowedChoices(): Promise<Map<string, string[]>> {
  if (cachedChoices) return cachedChoices

  const data = await admin<{
    metafieldDefinitions: {
      edges: Array<{ node: {
        key: string
        validations: Array<{ name: string; value: string | null }>
      } }>
    }
  }>(`
    {
      metafieldDefinitions(first: 100, ownerType: PRODUCT, namespace: "custom") {
        edges { node { key validations { name value } } }
      }
    }
  `, {})

  const choices = new Map<string, string[]>()
  for (const edge of data.metafieldDefinitions.edges) {
    const rule = edge.node.validations.find((v) => v.name === 'choices')
    if (!rule?.value) continue
    try {
      const list = JSON.parse(rule.value) as string[]
      if (Array.isArray(list) && list.length) choices.set(edge.node.key, list)
    } catch {
      // A validation we cannot read is one we do not enforce.
    }
  }
  cachedChoices = choices
  return choices
}

/**
 * The fields this system knows, written without disturbing the rest.
 *
 * `metafieldsSet` is an upsert per field: what is named is written, what is
 * not named is untouched. That is the only safe way to put anything on a
 * product somebody else also edits, and the difference between this and
 * passing the same list to `productSet` is seventeen fields.
 *
 * Written on every push, not only on creation. They are derived from the
 * record, so re-asserting them costs one call and repairs anything that has
 * drifted or been lost.
 */
async function writeMetafields(
  productId: string,
  watch: SyncWatch,
  taxonomy?: MetaobjectIndex,
): Promise<void> {
  const choices = await allowedChoices()

  const metafields = [
    { namespace: 'custom', key: 'reference', type: 'single_line_text_field', value: watch.model },
    ...(watch.serial
      ? [{ namespace: 'custom', key: 'serial', type: 'single_line_text_field', value: watch.serial }]
      : []),
    // Where the piece physically is, which drives the shop's own region filter.
    ...(watch.locationName
      ? [{ namespace: 'custom', key: 'location', type: 'single_line_text_field', value: watch.locationName }]
      : []),
    ...(taxonomy ? resolveMetafields(watch, taxonomy).metafields : []),
  ]
    // A field with a fixed list of choices takes one of them or nothing. This
    // system's own vocabulary is not the shop's — a location here is a room,
    // and over there it is a country — so a value the field will not accept is
    // left unsaid rather than sent to be refused.
    .filter((field) => {
      const allowed = choices.get(field.key)
      return !allowed || allowed.includes(field.value)
    })
    .map((field) => ({ ...field, ownerId: productId }))

  if (metafields.length === 0) return

  const FIELDS = `
    mutation Fields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { field message } }
    }
  `

  const data = await admin<{
    metafieldsSet: { userErrors: Array<{ field?: string[] | null; message: string }> }
  }>(FIELDS, { metafields })

  if (!data.metafieldsSet.userErrors?.length) return

  /**
   * One refused field must not lose the other ten.
   *
   * `metafieldsSet` takes the batch or nothing, so a single value the shop
   * will not accept cost a watch everything else the sync knew about it — and
   * with one such value on every watch, the whole run wrote nothing at all.
   * Sent one at a time, the good ones land and only the refusal is reported.
   */
  const refusals: string[] = []
  for (const field of metafields) {
    try {
      const one = await admin<{
        metafieldsSet: { userErrors: Array<{ field?: string[] | null; message: string }> }
      }>(FIELDS, { metafields: [field] })
      assertNoUserErrors(one.metafieldsSet.userErrors)
    } catch (error) {
      refusals.push(`${field.key}: ${(error as Error).message}`)
    }
  }

  if (refusals.length) throw new Error(refusals.join('; '))
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

/**
 * Put the product in the shop window.
 *
 * A product created through the API exists and is not for sale. It has to be
 * attached to a sales channel as a separate act, which is why a first sync
 * leaves a hundred correct products that nobody browsing the site can see —
 * they are in the admin, and only in the admin.
 *
 * Found by name rather than configured, because "Online Store" is the channel
 * on every shop that has one and an id in an environment variable is one more
 * thing to get wrong. Cached for the run; a shop does not gain a storefront
 * halfway through a sync.
 */
let cachedPublication: { id: string | null; denied: string | null } | null = null

async function onlineStorePublication(): Promise<{ id: string | null; denied: string | null }> {
  if (cachedPublication) return cachedPublication
  try {
    const data = await admin<{
      publications: { edges: Array<{ node: { id: string; name: string } }> }
    }>(`{ publications(first: 20) { edges { node { id name } } } }`, {})

    const found = data.publications.edges.find((e) => e.node.name === 'Online Store')
    cachedPublication = { id: found?.node.id ?? null, denied: null }
  } catch (error) {
    // Reading the list of sales channels needs the `read_publications` scope,
    // and an app without it is refused rather than handed an empty list. That
    // refusal is a fact about this app's permissions, not about the watch being
    // pushed — so it is remembered, reported once, and not allowed to discredit
    // the work that had already succeeded.
    cachedPublication = { id: null, denied: (error as Error).message.slice(0, 300) }
  }
  return cachedPublication
}

/**
 * Publish, idempotently.
 *
 * Publishing something already published is not an error, so this is safe to
 * repeat — which matters, because the commonest way to reach this code is a
 * second run after the first was cut short.
 *
 * Hands back what went wrong instead of throwing it. This is the last and the
 * least consequential step of a push: by the time it runs, the product, its
 * price, its stock, its status and its seventeen structured fields have all
 * been written, and a product already in the shop window gains nothing from
 * it. Letting it throw reported a hundred and thirty-one watches as failing
 * when every one of them was on the shop and right — which is worse than
 * useless, because it hides the failures that are real.
 */
export async function publishToOnlineStore(productId: string): Promise<string | null> {
  const { id: publicationId, denied } = await onlineStorePublication()
  if (denied) return denied
  if (!publicationId) return null

  try {
    const data = await admin<{
      publishablePublish: { userErrors: Array<{ field?: string[] | null; message: string }> }
    }>(`
      mutation Publish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) { userErrors { field message } }
      }
    `, { id: productId, input: [{ publicationId }] })

    assertNoUserErrors(data.publishablePublish.userErrors)
    return null
  } catch (error) {
    return (error as Error).message.slice(0, 300)
  }
}

export interface SyncOutcome {
  created: number
  updated: number
  archived: number
  removed: number
  failed: Array<{ what: string; error: string }>
  /**
   * Structured fields the shop has no entry for.
   *
   * Not a failure — the product is live and correct without them — but the
   * theme filters on these, so a watch missing one is a watch that will not
   * appear when somebody browses by dial colour. Worth saying out loud rather
   * than leaving to be noticed.
   */
  unmatched: Array<{ stockNo: number; field: string; value: string }>
  /** Entries added to the shop's own lists, where it allows that. */
  added: Array<{ type: string; name: string }>
  /**
   * What the shop refused this app permission to do.
   *
   * Kept apart from `failed` on purpose. A missing scope is one line of setup
   * that affects every watch identically; listing it against each of them in
   * turn produces a hundred identical failures and buries the one that is
   * really a watch's own problem.
   */
  denied: string[]
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
  // Needed for every push now, not only for creations: the structured fields
  // are re-asserted each time so that anything lost is put back.
  const taxonomy = await loadMetaobjects()
  const outcome: SyncOutcome = {
    created: 0, updated: 0, archived: 0, removed: 0,
    failed: [], unmatched: [], added: [], denied: [],
  }
  // The same refusal arrives once per watch; it is worth saying once.
  const refused = new Set<string>()

  // Fill the gaps the shop will accept being filled, before anything is
  // pushed, so the watches that wanted them find them.
  const all = [...computed.create, ...computed.update.map((u) => u.watch)]
  const additions = await createMissing(all, taxonomy)
  outcome.added = additions.created
  if (additions.blocked) {
    logger.info('metaobject creation unavailable', { reason: additions.blocked })
    refused.add(additions.blocked)
  }

  if (taxonomy) {
    for (const watch of [...computed.create, ...computed.update.map((u) => u.watch)]) {
      for (const miss of resolveMetafields(watch, taxonomy).unmatched) {
        outcome.unmatched.push({ stockNo: watch.stockNo, field: miss.type, value: miss.name })
      }
    }
  }

  const pushes: Array<{ watch: SyncWatch; productId: string | null; title?: string }> = [
    ...computed.create.map((watch) => ({ watch, productId: null })),
    ...computed.update.map((u) => ({ watch: u.watch, productId: u.productId, title: u.title })),
  ]

  for (const { watch, productId: existing, title } of pushes) {
    try {
      // The plan's product id wins over the one cached on the row: the plan
      // was built from what the store has now, and the cache may be pointing
      // at a page somebody deleted by hand.
      const { productId, warning } = await pushWatch(
        { ...watch, shopifyProductId: existing }, rates, taxonomy, title,
      )
      if (warning) refused.add(warning)
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

  outcome.denied = [...refused]
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
    const { productId, warning } = await pushWatch(watch, rates)
    if (warning) logger.warn('storefront push incomplete', { watchId, warning })
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
  /** What the failures actually say, which is the only useful part of a count. */
  errors: Array<{ stockNo: number; message: string }>
  /** Values the shop has no entry for, so they can be added rather than missed. */
  unmatched: Array<{ field: string; value: string; count: number }>
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
    // Aggregates come back from the driver as strings, not numbers.
    listed: Number(row?.listed ?? 0),
    failing: Number(row?.failing ?? 0),
    // And a timestamp out of a raw `max()` is whatever the driver decided to
    // make of it — a Date on one path, a string on another. The caller formats
    // it, so handing it something that only sometimes has `toISOString` is how
    // a settings page renders perfectly until the first sync has run and then
    // starts throwing.
    lastSyncedAt: asDate(row?.lastSyncedAt),
    errors: await recentErrors(),
    unmatched: await unmatchedValues(),
  }
}

/**
 * Values this system holds that the shop has no entry for.
 *
 * Computed rather than remembered, so it is true now rather than true at the
 * end of the last run. These are not errors — the watch is listed, priced and
 * correct without them — but the shop filters on them, so a material with no
 * entry is a material nobody can browse by. Naming them is the difference
 * between a gap somebody can close and one they will never find.
 */
async function unmatchedValues(): Promise<Array<{ field: string; value: string; count: number }>> {
  if (!shopifyIsConfigured()) return []
  try {
    const [stock, taxonomy] = await Promise.all([syncableWatches(), loadMetaobjects()])
    const tally = new Map<string, { field: string; value: string; count: number }>()

    for (const watch of stock) {
      if (!HELD_FOR_SHOP.has(watch.status)) continue
      for (const miss of resolveMetafields(watch, taxonomy).unmatched) {
        const key = `${miss.type}:${normalise(miss.name)}`
        const seen = tally.get(key)
        if (seen) seen.count += 1
        else tally.set(key, { field: miss.type, value: miss.name, count: 1 })
      }
    }

    return [...tally.values()].sort((a, b) => b.count - a.count).slice(0, 25)
  } catch {
    // A reading that cannot be taken is not worth failing the page over.
    return []
  }
}

const HELD_FOR_SHOP = new Set(['IN_STOCK', 'RESERVED', 'SALE_AGREED'])

/**
 * The failures, in the shop's own words.
 *
 * A page that says "131 failing" and nothing else tells somebody only that
 * they cannot fix it. The message Shopify refused with is the whole of the
 * useful information, so it belongs on the screen rather than in a log nobody
 * can reach. Distinct messages only: a hundred and thirty-one copies of one
 * sentence is the same sentence.
 */
async function recentErrors(): Promise<Array<{ stockNo: number; message: string }>> {
  const rows = await db
    .select({ stockNo: watches.stockNo, message: watches.shopifyError })
    .from(watches)
    .where(and(isNull(watches.deletedAt), isNotNull(watches.shopifyError)))
    .orderBy(watches.stockNo)
    .limit(200)

  const seen = new Set<string>()
  const distinct: Array<{ stockNo: number; message: string }> = []
  for (const row of rows) {
    const message = (row.message ?? '').trim()
    if (!message || seen.has(message)) continue
    seen.add(message)
    distinct.push({ stockNo: row.stockNo, message })
    if (distinct.length >= 5) break
  }
  return distinct
}

function asDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Forget the storefront's ids, so the next sync re-matches from scratch. */
export async function forgetLinks(watchIds?: string[]): Promise<void> {
  await db.update(watches)
    .set({ shopifyProductId: null, shopifySyncedAt: null, shopifyError: null })
    .where(watchIds?.length ? inArray(watches.id, watchIds) : sql`true`)
  await db.update(watchImages).set({ shopifyMediaId: null }).where(sql`true`)
}
