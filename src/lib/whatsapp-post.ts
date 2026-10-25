/**
 * A watch, written out for a dealer group.
 *
 * The thing being produced is a WhatsApp message, which is a specific medium
 * with specific manners: no markdown, no table, no header — a few short lines
 * that read on a phone in a scrolling group, where a long message is collapsed
 * behind "Read more" and goes unread.
 *
 * Deliberately not the shop's title. `titleFor` writes for a storefront, where
 * the brand sits above the title on the card and the reference is the thing a
 * buyer searches; a dealer reading a group has no card and no search box, so
 * the brand goes back on the front and the reference gets a line of its own.
 */

/** Only what goes in the message. Nothing here is a cost or a margin. */
export interface PostableWatch {
  brandName: string
  /** The reference number, which is what this column actually holds. */
  model: string
  /** The name — "Submariner Date", "Hulk". Labelled "Model" in the form. */
  modelName: string | null
  year: number | null
}

export interface PostOptions {
  /**
   * The trade price, already formatted for display — "AED 48,500".
   *
   * Formatted by the caller rather than here, because the currency and the
   * rate table live on the server and this is a pure string builder. Null
   * where no trade price is set: a watch that has not been priced is posted
   * without a price rather than with a blank one, which reads as free.
   */
  tradePrice: string | null
}

/**
 * The name a dealer would say out loud.
 *
 * The model name verbatim, with the brand in front of it. Deliberately not
 * `familyOf`, which takes the case size off the end so the shop can group a
 * Datejust 41 and a Datejust 36 under one menu heading. That is right for a
 * menu and wrong here: to a dealer those are two different watches at two
 * different prices, and a post headed "Rolex Datejust" against a picture of a
 * 41 invites exactly the question the message exists to pre-empt.
 */
export function postTitle(watch: PostableWatch): string {
  const brand = watch.brandName.trim()
  const name = watch.modelName?.trim()
  if (!name) return brand
  // The model name often carries the brand already — "Rolex Datejust 41" — and
  // putting it in front again reads as a stutter.
  const lower = name.toLowerCase()
  if (lower === brand.toLowerCase() || lower.startsWith(`${brand.toLowerCase()} `)) return name
  return `${brand} ${name}`
}

/**
 * The message.
 *
 * One fact per line, labelled, because a group reader is skimming for the
 * reference and the year rather than reading a sentence. A field with nothing
 * in it is left out entirely — "Year: —" is noise, and an em dash in a
 * WhatsApp message looks like a mistake rather than an absence.
 */
export function whatsappPost(watch: PostableWatch, options: PostOptions): string {
  const lines: string[] = [postTitle(watch)]

  const reference = watch.model?.trim()
  if (reference) lines.push(`Ref: ${reference}`)
  if (watch.year) lines.push(`Year: ${watch.year}`)
  if (options.tradePrice) lines.push(`Trade: ${options.tradePrice}`)

  return lines.join('\n')
}

/**
 * What the photograph is called when it arrives on somebody's phone.
 *
 * The share sheet shows a filename, and "image.jpg" tells the person sending
 * it nothing about what they are about to post. The reference is the thing
 * that identifies it; anything that cannot sit in a filename is dropped.
 */
export function postFilename(watch: PostableWatch, mimeType: string): string {
  const extension = mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
  const stem = [watch.brandName, watch.model]
    .filter(Boolean)
    .join('-')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${stem || 'watch'}.${extension}`
}

/**
 * Which photograph goes to the group.
 *
 * The trade shot first. That is the one prepared for sending — framed,
 * cropped, often already carrying the dealer's own treatment — and it is the
 * picture somebody reaches for when posting. The main watch shot is the
 * fallback for a record that has no trade shot yet.
 *
 * Never a warranty card or a document. Both carry a serial, a date and a
 * dealer's stamp, and this message can be forwarded on by anybody who
 * receives it. Decided here rather than at each call site so the record and
 * the drawer cannot come to different conclusions about it.
 */
export function pickPostImage<T extends { id: string; kind: string }>(
  images: readonly T[],
): string | null {
  return images.find((image) => image.kind === 'TRADE')?.id
    ?? images.find((image) => image.kind === 'WATCH')?.id
    ?? null
}
