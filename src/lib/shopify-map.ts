import { fromBase, type RateTable } from './currency'
import { CONDITION_LABELS, type Condition, type CurrencyCode } from './enums'

/**
 * What a watch looks like as a Shopify product, and what has to change.
 *
 * Kept away from the network on purpose. Everything here is a pure function of
 * two lists — the stock we hold and the products the store currently has — so
 * the decision to delete somebody's live product page can be tested, which is
 * not true of anything that needs an access token to run.
 *
 * The shop is a mirror. The inventory system is the book of record and Shopify
 * reflects it; nothing flows the other way. That single rule is what makes a
 * plan computable at all: there is no merge to do, only a difference to apply.
 */

/** The statuses that mean we still have the watch. */
const HELD = new Set(['IN_STOCK', 'RESERVED', 'SALE_AGREED'])

/**
 * A SKU we recognise as ours.
 *
 * The store already used stock numbers as SKUs before any of this existed,
 * which is the whole reason no matching exercise is needed: the join key was
 * already in the data. Anything else — a hand-made placeholder, a blank — is a
 * product this system did not create.
 */
export function isManagedSku(sku: string | null | undefined): boolean {
  return typeof sku === 'string' && /^\d{1,10}$/.test(sku.trim())
}

export function skuFor(stockNo: number): string {
  return String(stockNo)
}

export interface SyncWatch {
  id: string
  stockNo: number
  brandName: string
  model: string
  serial: string | null
  nickname: string | null
  year: number | null
  status: string
  /** Where the piece physically is, which drives the shop's region filter. */
  locationName: string | null
  /** Whether that place is one the website is allowed to sell from. */
  locationPublishes: boolean
  estSaleGbp: number | null
  caseSizeMm: number | null
  caseMaterial: string | null
  dial: string | null
  bracelet: string | null
  movement: string | null
  waterResistanceM: number | null
  condition: string
  boxPapers: string
  description: string | null
  /** The photographs, in the order they are arranged, with whatever the shop
      is already holding of each. */
  images: WatchPhotograph[]
  shopifyProductId: string | null
  /**
   * What the last successful push said about this watch.
   *
   * Null for a watch never pushed, or one pushed before this column existed,
   * and a null always counts as "needs pushing" — the safe answer when we do
   * not know. See `fingerprintFor`.
   */
  shopifyFingerprint?: string | null
}

/** A product as the store has it now. */
export interface SyncProduct {
  id: string
  sku: string | null
  title: string
  status: string
  /**
   * What the page tells Google it is called, which is not the same thing as
   * the title. Carried so that one somebody wrote by hand is never overwritten.
   */
  seoTitle: string | null
  /**
   * When the shop put this in its window, or null for never.
   *
   * Status and visibility are two different facts and this is the one the
   * plan never read. A product can be ACTIVE, priced, stocked, photographed
   * and attached to no sales channel at all, in which case it is in the admin
   * and nowhere else — indistinguishable, from the website, from a watch the
   * sync had never heard of. Ten watches sat like that for a day and the only
   * thing that noticed was somebody looking at the site.
   */
  publishedAt: string | null
}

/** One photograph, and the copy of it the storefront already holds. */
export interface WatchPhotograph {
  id: string
  /** The media row on Shopify, once this photograph has been sent there. */
  mediaId: string | null
}

export type ShopifyStatus = 'ACTIVE' | 'DRAFT' | 'ARCHIVED'

/**
 * Is this watch somewhere the website may sell from?
 *
 * Read from a switch on the location rather than from its type, which is how
 * this started. Transit was the case that prompted it and the type was right
 * about transit, but a rule in the code is one only an engineer can change
 * and only this one case had been thought of — a bonded warehouse, a piece
 * away at service, a consignment case in somebody else's shop are all the
 * same question and none of them is typed TRANSIT.
 */
export function sellableFrom(watch: Pick<SyncWatch, 'locationPublishes'>): boolean {
  return watch.locationPublishes
}

/**
 * Whether a watch should be on the storefront, and in what state.
 *
 * A watch with no retail price is not a listing. Publishing one means either a
 * price of zero on the page or a figure invented to fill the field, and both
 * are worse than the watch being absent — so it goes up as a draft, where it
 * is ready the moment somebody prices it.
 *
 * A watch somewhere we do not sell from comes off the shop entirely:
 * "anything not pushed should not be on Shopify". It is archived, which is
 * what every other watch the shop should not be showing already gets, and it
 * is checked before the price because it is the stronger statement — a piece
 * in a courier's bag has no business on the storefront whether or not
 * somebody has got round to pricing it.
 *
 * Archived rather than deleted, for the same reason a sold watch is archived
 * rather than deleted: it comes back. A product carries its handle, its
 * search ranking and its photographs, and deleting one means the piece
 * returns from Dubai as a new page at a new URL with every picture to upload
 * again. Archived, it is off the storefront, out of the active catalogue and
 * unbuyable — and the moment somebody moves it to a place that does sell,
 * the next push restores it intact, with nothing to remember and nothing to
 * tidy up.
 *
 * Note what this is NOT: silently skipping the watch. Skipping leaves
 * whatever is on the shop exactly as it was, so a piece that was live and
 * then went out on loan would stay live and buyable. Nothing new is created
 * for it (see planSync), but a page that exists is always brought down.
 */
export function statusFor(
  watch: Pick<SyncWatch, 'status' | 'estSaleGbp' | 'locationPublishes'>,
): ShopifyStatus {
  if (!HELD.has(watch.status)) return 'ARCHIVED'
  if (!sellableFrom(watch)) return 'ARCHIVED'
  if (watch.estSaleGbp === null || watch.estSaleGbp <= 0) return 'DRAFT'
  return 'ACTIVE'
}

/**
 * How many we have, which for a watch is one or none.
 *
 * Reserved and sale-agreed stock stays visible but unbuyable: the page is
 * still worth having — it is what somebody was sent a link to — and the watch
 * is genuinely spoken for.
 */
export function quantityFor(watch: Pick<SyncWatch, 'status' | 'locationPublishes'>): number {
  // Nothing to sell from a place we do not sell from. The page is a draft
  // anyway, so this only matters for the moment after it moves and before the
  // next push — but a stock figure that says one when the watch is in the air
  // is still wrong, and the figure is what an oversell would be counted from.
  if (!sellableFrom(watch)) return 0
  return watch.status === 'IN_STOCK' ? 1 : 0
}

/** The price, in the store's own currency. */
export function priceFor(
  estSaleGbp: number | null,
  storeCurrency: CurrencyCode,
  rates: RateTable,
): string | null {
  if (estSaleGbp === null || estSaleGbp <= 0) return null
  return (fromBase(estSaleGbp, storeCurrency, rates) / 100).toFixed(2)
}

/**
 * The name on the page.
 *
 * Reference first for anything a buyer searches by, because that is what they
 * type. The nickname earns its place — "Hulk" sells a 116610LV — and the year
 * belongs in the title for a watch where it changes the thing entirely.
 */
export function titleFor(watch: SyncWatch): string {
  // No brand. The card already carries it above the title, and a page headed
  // "Rolex / Rolex 126334" says it twice — which is also how the shop's brand
  // menu ended up with a hundred families of one.
  const family = familyOf(watch)
  // Nothing to build a name out of. The reference on its own is what a dealer
  // would say, and it is better than dressing it up with a measurement into
  // "116334 41", which reads like two references.
  if (!family) return watch.model

  const dial = watch.dial?.trim()
  return [
    family,
    // A dial name earns its place when it is a colour. "Champagne with Factory
    // Diamond Hour Markers" is a description, and a title is not where a
    // description goes.
    dial && dial.length <= 20 ? dial : null,
    watch.caseSizeMm ? String(watch.caseSizeMm) : null,
  ].filter(Boolean).join(' ')
}

/**
 * Is this a title this system wrote, or one somebody chose?
 *
 * The shop's own titles lead with the family — "Explorer II Black 42" — and
 * never with the brand. The ones written here before that was understood lead
 * with it, so the brand at the front is the signature of a generated title and
 * a safe licence to replace it.
 *
 * It self-heals in the right direction too: edit one by hand into the shop's
 * convention and it stops starting with the brand, which is exactly when this
 * system should stop touching it.
 */
export function titleIsOurs(title: string, watch: SyncWatch): boolean {
  return title.trim().toLowerCase().startsWith(`${watch.brandName.trim().toLowerCase()} `)
}

/**
 * The family a watch belongs to — Datejust, GMT-Master II, Day-Date.
 *
 * The shop groups its brand menu by this, and it is the one field the record
 * does not hold directly: `model` here is the reference number, which is what
 * a dealer files by, while a shop window is browsed by name. The nickname is
 * where the name actually lives — "Sky-Dweller", "Datejust 41" — so the family
 * is that with the case size taken off the end, since a 41 and a 31 are the
 * same family in two sizes and splitting them makes a menu of one-offs.
 *
 * Returns null rather than guessing from the reference. A reference prefix
 * implies a family only if you already know Rolex's numbering, and a menu
 * confidently filed under the wrong name is worse than one with a gap in it.
 */
export function familyOf(watch: SyncWatch): string | null {
  const name = watch.nickname?.trim()
  if (!name) return null
  // "Datejust 41" -> "Datejust"; "Lady-Datejust 28" -> "Lady-Datejust".
  //
  // Only a plausible case size comes off, between 20 and 60 millimetres. A
  // bare "trailing number" rule reads "RM 011" as an RM in 11mm and files a
  // Richard Mille under "RM", and leaves "Nautilus 5711" alone only by
  // accident. Roman numerals are left where they are: the II in Datejust II
  // is part of the name.
  const family = name.replace(/\s+(\d{2})(\s*mm)?$/i, (whole, size: string) => (
    Number(size) >= 20 && Number(size) <= 60 ? '' : whole
  )).trim()
  return family || null
}

/* ================= the photographs ================= */

/** One entry in a product's file list: an upload, or one already there. */
export interface MediaFile {
  id?: string
  originalSource?: string
  contentType?: 'IMAGE'
  alt?: string
}

/**
 * The product's photographs, as the shop should hold them.
 *
 * `files` on productSet is declarative, the same way metafields turned out to
 * be: the list given becomes the whole list, and anything left out is
 * removed. That is what makes a real mirror possible — a photograph deleted
 * here goes from the shop too, and the order they are arranged in is the
 * order they appear on the page.
 *
 * Each one is sent as whichever of two things it is. A photograph the shop
 * already holds is named by its media id, so it stays where it is and
 * nothing is uploaded again; one it has never seen is sent as a URL for
 * Shopify to come and fetch. So the first sync after this uploads
 * everything once, and every sync after it uploads only what changed.
 *
 * A watch with no photographs sends an EMPTY list, which removes every
 * picture from the product. That is the point, and it was the other half of
 * the same complaint: two Lady-Datejusts, one photographed here and one not,
 * showed the same picture on the shop — because the unphotographed one was
 * keeping an image somebody had uploaded to Shopify months earlier, of a
 * different watch. Leaving it alone was the cautious reading and it was the
 * wrong one: a photograph of the wrong watch is worse than no photograph, and
 * a mirror that declines to mirror the empty case is not a mirror. The queue
 * that chases this is already on the insights page — "watches have no
 * photographs" is now, exactly, the list of products with no picture.
 *
 * Verified against the shop rather than assumed: `files: []` on a throwaway
 * product did clear its media, and `productSet` is declarative here the same
 * way it turned out to be for metafields.
 *
 * Null still means "say nothing", and two cases keep it:
 *
 *   - No origin. We cannot offer an upload without our own address, and a
 *     missing environment variable must not be able to strip the shop bare.
 *     Nothing is the only safe answer to not knowing.
 *   - A watch that has left the book. Its page is archived and off the
 *     storefront already, so there is no wrong picture to show anybody; the
 *     door Shopify fetches from is shut for sold stock, so an upload would
 *     404; and an archived page can be brought back, which it cannot be if
 *     this empties it on the way past. Mirroring it costs a record and gains
 *     nothing a customer could ever see.
 */
export function mediaFilesFor(watch: SyncWatch, origin: string | null): MediaFile[] | null {
  if (!origin) return null
  if (statusFor(watch) === 'ARCHIVED') return null

  return watch.images.map((photograph) => (photograph.mediaId
    ? { id: photograph.mediaId }
    : {
      originalSource: `${origin}/api/storefront-image/${photograph.id}`,
      contentType: 'IMAGE' as const,
      alt: titleFor(watch),
    }))
}

/* ================= what a search engine is shown =================
   A product page had no search title and no description at all — every one of
   the hundred and thirty-one. Shopify falls back to the product title when
   those are empty, so the result read "Datejust II Fluted 41", with no maison,
   no reference and nothing about the piece.

   Nobody searches for that. They search "Rolex Datejust 116334", or
   "pre-owned Submariner Dubai", and the two things that decide whether this
   shop is in the answer — the brand and the reference — were the two things
   the page never said.

   Both are derived rather than written, which is the only way this stays true
   of stock nobody has got to yet: every watch added from here gets the same
   treatment on its first push.
   ============================================================= */

/** The shop, as the end of a search result. */
const SHOP = 'One Street Watches'

/**
 * Where Google stops reading.
 *
 * Neither is a hard limit — the tag may be any length — but past these it
 * truncates, and a sentence cut mid-word is worse than a shorter one that
 * finishes. The title is held to the width rather than the pixel count, which
 * is the usual approximation and good enough for stock numbers and metals.
 */
const SEO_TITLE_MAX = 65
const SEO_DESCRIPTION_MAX = 155

/** Two spellings of one thing, for deciding whether it has been said already. */
const flat = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * A last resort, for a piece whose name alone fills the whole description.
 *
 * Cut at the last space rather than at the character, so the sentence ends on
 * a word and then a full stop — a description that stops mid-word reads as a
 * fault in the page rather than as an abbreviation.
 */
function clamp(text: string): string {
  if (text.length <= SEO_DESCRIPTION_MAX) return text
  const cut = text.slice(0, SEO_DESCRIPTION_MAX - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}.`
}

/**
 * The piece, named the way somebody would type it into a search box.
 *
 * Maison, family, reference — in that order, and each only if the ones before
 * it have not already said it. "Rolex Submariner Date 116610LV", but not
 * "Rolex Rolex Submariner" when the nickname carries the brand, and not
 * "Datejust 41 116334 41" when the family already holds the size.
 */
function subjectPartsOf(watch: SyncWatch): string[] {
  const parts: string[] = []
  for (const part of [watch.brandName, familyOf(watch), watch.model?.trim()]) {
    if (!part) continue
    const said = flat(parts.join(' '))
    const next = flat(part)
    // Already said: "Datejust 41" after a family that is "Datejust 41".
    if (said.includes(next)) continue
    // Says it all and more: a nickname of "Rolex Submariner Date" after the
    // maison "Rolex" is not a second thing to add, it is a better way of
    // saying the first. Testing only one of these two directions is how the
    // title came out as "Rolex Rolex Submariner Date".
    if (parts.length > 0 && next.includes(said)) parts.length = 0
    parts.push(part)
  }
  return parts
}

function subjectOf(watch: SyncWatch): string {
  return subjectPartsOf(watch).join(' ')
}

/**
 * The title a search result carries.
 *
 * Always ends with the shop, and that is load-bearing in two ways: it is what
 * makes the result recognisable in a list of ten, and it is how this system
 * later recognises its own work. Somebody who writes their own search title
 * will not end it this way, and `seoIsOurs` leaves theirs alone.
 */
export function seoTitleFor(watch: SyncWatch): string {
  const suffix = ` | ${SHOP}`
  const parts = subjectPartsOf(watch)

  // Too long is answered by dropping the family, never by cutting characters.
  // An Audemars reference is twenty characters — 15500ST.OO.1220ST.01 — and
  // trimming the line to fit left "15500ST.OO.1220ST." on the end of it: a
  // reference that matches nothing, in the one place a search would have
  // matched on it. The maison and the reference are what people type; the
  // family is the part a result can do without.
  while (parts.length > 2 && `${parts.join(' ')}${suffix}`.length > SEO_TITLE_MAX) {
    parts.splice(1, 1)
  }

  // And if even that is long, it stays long. The width is where a search
  // result stops showing the title, not where the tag has to end, and a
  // complete name past the fold beats a truncated one inside it.
  return `${parts.join(' ')}${suffix}`
}

/** How a watch's kit reads in a sentence. Silence where nothing is recorded. */
const KIT_PHRASE: Record<string, string> = {
  FULL_SET: 'with box and papers',
  BOX_ONLY: 'with its box',
  PAPERS_ONLY: 'with its papers',
  WATCH_ONLY: 'watch only',
}

/**
 * The paragraph under the result.
 *
 * Three sentences, in the order somebody reading a list of search results
 * cares about them: what it is, what condition it is in, and why to buy it
 * here. Built up one sentence at a time and stopped before the limit rather
 * than cut at it, so the description always ends on a full stop.
 *
 * No price. It is the one fact here that moves weekly, and a search engine
 * will go on showing a figure months after it changed — which is a worse
 * first impression than no figure at all.
 */
export function seoDescriptionFor(watch: SyncWatch): string {
  const opening = [watch.year ? String(watch.year) : null, subjectOf(watch)]
    .filter(Boolean).join(' ')
  const material = watch.caseMaterial?.trim()
  const size = watch.caseSizeMm ? `, ${watch.caseSizeMm}mm` : ''

  // The opening sentence, then the same sentence with less in it. A long
  // enough name and a typed-out metal can fill the whole budget between them
  // — and a loop that only ever adds sentences while they fit answered that
  // by returning nothing at all, which is what the store had already.
  const sentences = [[
    `${opening}${material ? ` in ${material}` : ''}${size}.`,
    `${opening}${size}.`,
    `${opening}.`,
  ].find((line) => line.length <= SEO_DESCRIPTION_MAX) ?? clamp(`${opening}.`)]

  const grade = watch.condition && watch.condition !== 'UNKNOWN'
    ? CONDITION_LABELS[watch.condition as Condition]
    : null
  // "Unworn condition" is not how anybody says it.
  const condition = grade === 'Unworn' ? 'Unworn' : grade ? `${grade} condition` : null
  const kit = KIT_PHRASE[watch.boxPapers] ?? null
  if (condition && kit) sentences.push(`${condition}, ${kit}.`)
  else if (condition) sentences.push(`${condition}.`)
  else if (kit) sentences.push(`${kit[0]!.toUpperCase()}${kit.slice(1)}.`)

  const where = watch.locationName?.trim()
  sentences.push(where
    ? `Authenticated at our own bench and held in ${where}.`
    : 'Authenticated at our own bench.')

  let out = ''
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence}` : sentence
    if (next.length > SEO_DESCRIPTION_MAX) break
    out = next
  }
  return out
}

/**
 * Whether the search title on the page is this system's to rewrite.
 *
 * Empty counts as ours: there is nothing to protect. Anything else is only
 * ours if it ends the way `seoTitleFor` ends them, which is the same test
 * `titleIsOurs` makes for the product title and for the same reason — the
 * moment somebody writes their own, this stops touching it.
 */
export function seoIsOurs(title: string | null | undefined): boolean {
  const current = title?.trim()
  if (!current) return true
  return current.endsWith(SHOP)
}

const SPEC_LABELS: Array<[keyof SyncWatch, string, (v: never) => string]> = [
  ['year', 'Year', (v: number) => String(v)],
  ['caseSizeMm', 'Case', (v: number) => `${v}mm`],
  ['caseMaterial', 'Material', (v: string) => v],
  ['dial', 'Dial', (v: string) => v],
  ['bracelet', 'Bracelet', (v: string) => v],
  ['movement', 'Movement', (v: string) => v],
  ['waterResistanceM', 'Water resistance', (v: number) => `${v}m`],
] as never

/**
 * The description, as the specification plus whatever was written about it.
 *
 * Built from the record rather than typed into Shopify, because a description
 * maintained in two places is a description that disagrees with itself. Rows
 * with nothing in them are left out instead of being filled with "unknown",
 * which on a watch page reads as a warning rather than an absence.
 */
export function descriptionHtmlFor(watch: SyncWatch): string {
  const rows = SPEC_LABELS
    .map(([key, label, format]) => {
      const value = watch[key]
      return value === null || value === undefined || value === ''
        ? null
        : `<tr><th align="left">${label}</th><td>${escapeHtml(format(value as never))}</td></tr>`
    })
    .filter(Boolean)

  const prose = watch.description?.trim()
    ? `<p>${escapeHtml(watch.description.trim()).replace(/\n+/g, '</p><p>')}</p>`
    : ''

  return `${prose}${rows.length ? `<table>${rows.join('')}</table>` : ''}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface SyncPlan {
  /** Watches with no product yet. */
  create: SyncWatch[]
  /** Watches whose product exists and must be brought into line. */
  update: Array<{
    watch: SyncWatch
    productId: string
    title: string
    seoTitle: string | null
    /** What makes this one worth sending. Empty is never pushed. */
    reasons: UpdateReason[]
  }>
  /** Products for stock we no longer hold. */
  archive: Array<{ productId: string; sku: string | null; title: string }>
  /** Products that answer to no watch at all. */
  remove: Array<{ productId: string; sku: string | null; title: string }>
  /**
   * Products meant to be live that the shop holds in no sales channel.
   *
   * Every push already tries to publish what it sends, so this is not a
   * second way of doing it — it is the only way of finding out that the first
   * one is not working. Publishing is the one step of a push that can fail
   * while leaving the watch entirely correct, so it reports a warning instead
   * of throwing; and a warning shown in a toast is a warning nobody sees
   * twenty minutes later, when the question being asked is why one particular
   * watch is not on the website.
   *
   * Read from the shop rather than remembered, so it answers for the state of
   * things now and keeps answering however the publishing came to fail.
   */
  publish: Array<{ productId: string; sku: string | null; title: string }>
}

/**
 * Everything one push would say about this watch, in a single short string.
 *
 * The plan used to list every watch that had a page as needing an update,
 * which is not a difference — it is a headcount. It read "143 to update"
 * before a push and "143 to update" after one, because pushing had never been
 * what the number was counting. So Apply re-sent the entire book every time,
 * the run took minutes it did not need, and the one question the screen
 * exists to answer — did that work? — had no answer on it.
 *
 * A watch is now compared against what was last sent for it. Everything the
 * push writes goes in here: the price, the status, the quantity, the titles,
 * the photographs by the media row the shop holds for each, and the resolved
 * structured fields. Change any of them and the string changes; change
 * something the shop never sees — a cost price, a private note — and it does
 * not, which is the point.
 *
 * Not a cryptographic hash and not trying to be. It is only ever compared
 * with the previous value for the same watch, so all that is asked of it is
 * that a changed input changes the output.
 */
export function fingerprintFor(
  watch: SyncWatch,
  price: string | null,
  /** The metaobject ids resolved for this watch, in a stable order. */
  metafieldValues: string[],
): string {
  const parts = [
    skuFor(watch.stockNo),
    statusFor(watch),
    String(quantityFor(watch)),
    price ?? '',
    titleFor(watch),
    seoTitleFor(watch),
    seoDescriptionFor(watch),
    descriptionHtmlFor(watch),
    // By the shop's own media row, so a replaced photograph reads as a change
    // and a re-ordered one does too.
    watch.images.map((image) => `${image.id}:${image.mediaId ?? ''}`).join(','),
    [...metafieldValues].sort().join(','),
  ]
  return digest(parts.join('\u0000'))
}

/**
 * FNV-1a, twice, with different seeds.
 *
 * Thirty-two bits is a one-in-four-billion chance of two different payloads
 * agreeing, which would show up as a watch that quietly stops being pushed.
 * Two rounds make that number stop mattering, and the whole thing is eight
 * lines with no dependency.
 */
function digest(text: string): string {
  const round = (seed: number) => {
    let h = seed
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return (h >>> 0).toString(36)
  }
  return `${round(2166136261)}${round(2166136263)}`
}

/** Why a watch is on the update list. Shown, so the number can be believed. */
export type UpdateReason = 'record' | 'status' | 'renumbered' | 'invisible' | 'unknown'

/**
 * What it would take to make the store match the book.
 *
 * Computed whole, before anything is sent, so the irreversible half can be
 * read by a person first. `remove` is the dangerous list — products deleted
 * outright, which on a store with order history would break reporting and on
 * this one, where the site takes enquiries rather than payments, simply
 * removes pages nothing points at. Either way it is shown before it is done.
 *
 * A product whose SKU matches a watch we still hold is never removed, however
 * odd it looks; a duplicate SKU keeps the first product and removes the rest,
 * because two live pages for one watch is the thing that sells it twice.
 */
export function planSync(
  watches: SyncWatch[],
  products: SyncProduct[],
  /**
   * What a push would say about a watch right now, for comparison with what
   * the last one said. Omit it and every page is re-sent, which is what this
   * did before fingerprints existed and is still the right answer when the
   * caller cannot work out the desired state — a shop that cannot be read,
   * a taxonomy that would not load.
   */
  desiredFingerprint?: (watch: SyncWatch) => string,
): SyncPlan {
  const plan: SyncPlan = { create: [], update: [], archive: [], remove: [], publish: [] }

  const bySku = new Map<string, SyncProduct>()
  const duplicates: SyncProduct[] = []
  for (const product of products) {
    const sku = product.sku?.trim() ?? ''
    if (!isManagedSku(sku)) { plan.remove.push(descr(product)); continue }
    // First one wins. The second page for the same stock number is the one
    // that has to go, whichever of them somebody made first.
    if (bySku.has(sku)) { duplicates.push(product); continue }
    bySku.set(sku, product)
  }
  for (const product of duplicates) plan.remove.push(descr(product))

  /**
   * Which products a watch has claimed, by product id rather than by SKU.
   *
   * It was by SKU, which quietly assumed a watch's stock number never
   * changes. It can: the accounts are the system of record for what a piece
   * is called, and a sheet from them renumbers it here. Under the old
   * matching that watch's page was suddenly nobody's — archived at the bottom
   * of this function, with its photographs, metafields and publication state
   * — while a fresh page was created under the new number. The storefront
   * would have lost the listing and its URL to a change of label.
   *
   * Claimed in two passes, and a page may be claimed only once.
   *
   * The first pass takes the pages whose SKU still names a watch in the book,
   * because that is the store's own statement about what the page is. The
   * second gives what is left to whichever watch last pushed to it, which is
   * how a renamed piece keeps its page.
   *
   * One pass preferring the stored id would let two watches claim one page —
   * a stale pointer on one and a live SKU match on the other — and the two
   * would rename its SKU past each other on every sync, forever. The id is
   * what we remember; the SKU is what the store can still see.
   */
  const claimed = new Set<string>()
  const byId = new Map<string, SyncProduct>()
  for (const product of bySku.values()) byId.set(product.id, product)

  /**
   * Why this page is not already right.
   *
   * Three of the four answers come from the shop rather than from us, and
   * that is deliberate: a fingerprint only knows what we last sent, so on its
   * own it would never notice a product somebody archived, renamed or
   * unpublished by hand in the admin. Those are the cases where the book and
   * the shop have genuinely drifted, and they are exactly the ones a mirror
   * has to catch.
   */
  const reasonsFor = (watch: SyncWatch, product: SyncProduct): UpdateReason[] => {
    const reasons: UpdateReason[] = []
    // Nothing to compare against: never pushed, or pushed before any of this.
    // Treated as changed, so the first run after this lands does the whole
    // book once and every run after it does only what moved.
    if (!desiredFingerprint) return ['unknown']
    if (!watch.shopifyFingerprint) reasons.push('unknown')
    else if (watch.shopifyFingerprint !== desiredFingerprint(watch)) reasons.push('record')
    if (product.status !== statusFor(watch)) reasons.push('status')
    if (product.sku !== skuFor(watch.stockNo)) reasons.push('renumbered')
    if (statusFor(watch) === 'ACTIVE' && !product.publishedAt) reasons.push('invisible')
    return reasons
  }

  const take = (watch: SyncWatch, product: SyncProduct) => {
    claimed.add(product.id)
    const reasons = reasonsFor(watch, product)
    // A page that already says what we would say is left alone. That is the
    // whole saving: a quiet week is a handful of watches rather than the
    // entire catalogue re-uploaded, photographs and all.
    if (reasons.length) {
      plan.update.push({
        watch, productId: product.id, title: product.title, seoTitle: product.seoTitle, reasons,
      })
    }
    // Intent on this side, visibility on that side. A watch we mean to sell
    // whose page is in no sales channel is the silent failure: the product
    // is right, the sync reported success, and the website does not have it.
    if (statusFor(watch) === 'ACTIVE' && !product.publishedAt) plan.publish.push(descr(product))
  }

  const unmatched: SyncWatch[] = []
  for (const watch of watches) {
    const existing = bySku.get(skuFor(watch.stockNo))
    if (existing && !claimed.has(existing.id)) take(watch, existing)
    else unmatched.push(watch)
  }

  for (const watch of unmatched) {
    const existing = watch.shopifyProductId ? byId.get(watch.shopifyProductId) : undefined
    if (existing && !claimed.has(existing.id)) {
      take(watch, existing)
      continue
    }
    // A watch somewhere we do not sell from never gets a page made for it.
    // Asked for plainly: "we don't want to push in transit watches to
    // Shopify". Nothing is created, so the shop's catalogue only ever holds
    // pieces the business actually has, and a watch bought and still
    // travelling simply does not exist over there until it lands.
    //
    // Only CREATE is skipped, never UPDATE. A watch that was on the shop and
    // then went out on loan has a page already, and leaving that page alone
    // is the one outcome nobody wants: it stays live and buyable for a watch
    // that is in somebody's bag. Those are claimed above and go to DRAFT
    // through statusFor, which is what actually takes them down.
    if (HELD.has(watch.status) && watch.locationPublishes) plan.create.push(watch)
    // A sold watch with no product never needs one. Nor does one in transit.
  }

  for (const product of bySku.values()) {
    // A product no watch claimed. Archived rather than deleted: the likeliest
    // reason is a watch that has since been sold and tidied away, and an
    // archived page can be brought back.
    if (!claimed.has(product.id)) plan.archive.push(descr(product))
  }

  return plan
}

function descr(product: SyncProduct) {
  return { productId: product.id, sku: product.sku, title: product.title }
}
