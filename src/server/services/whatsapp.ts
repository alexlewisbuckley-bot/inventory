import { logger } from '@/lib/logger'

/**
 * Sending a WhatsApp message, over HTTP, with no dependency.
 *
 * Meta's Cloud API is a single POST, so this is `fetch` for the same reason
 * `mailer.ts` is: a package pulled in for one message is a lot of surface for
 * very little.
 *
 * Unconfigured is a supported state, not an error — the same contract the
 * mailer keeps. The caller writes what it is sending to the database first and
 * treats delivery as something that may or may not have happened, so an owner
 * still finds the enquiry in the application whether or not a message ever
 * left the building. A notification that only exists if an integration is
 * working is a notification that goes missing on the day it matters.
 *
 * ## What this needs to be live
 *
 * A Meta Business account with a WhatsApp Business Account on it, a phone
 * number registered to that account, and:
 *
 *   WHATSAPP_TOKEN            a permanent access token for the system user
 *   WHATSAPP_PHONE_NUMBER_ID  the sending number's id, not the number itself
 *   WHATSAPP_TEMPLATE         the approved template's name, for the
 *                             business-initiated case (see below)
 *
 * Meta will not let a business open a conversation with free text. Outside a
 * 24-hour window that the *recipient* opens by messaging first, only an
 * approved template may be sent. So this sends a template when one is
 * configured and plain text otherwise, and an owner who has never messaged
 * the business number will only receive the former. The template wants one
 * body variable, which is the line this builds.
 */

export interface WhatsAppResult {
  sent: boolean
  note: string
}

export function whatsappIsConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)
}

/**
 * A number as Meta wants it: digits only, no plus, no spaces.
 *
 * A UK number written `07700 900123` is not dialable internationally, and the
 * API takes it without complaint and delivers nothing. So a leading zero is
 * read as a national number and given the default country code, which is the
 * one assumption here and is stated rather than hidden.
 */
export function toWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/[^\d+]/g, '').replace(/^\+/, '')
  if (!digits) return null
  if (!raw.trim().startsWith('+') && digits.startsWith('0')) {
    const country = (process.env.WHATSAPP_DEFAULT_COUNTRY ?? '44').replace(/\D/g, '')
    return `${country}${digits.slice(1)}`
  }
  return digits
}

export async function sendWhatsApp(to: string, text: string): Promise<WhatsAppResult> {
  const token = process.env.WHATSAPP_TOKEN
  const from = process.env.WHATSAPP_PHONE_NUMBER_ID
  const template = process.env.WHATSAPP_TEMPLATE

  const number = toWhatsAppNumber(to)
  if (!number) {
    return { sent: false, note: 'No usable phone number on that account.' }
  }
  if (!token || !from) {
    logger.warn('whatsapp not configured; notification recorded but not relayed', { to: number })
    return {
      sent: false,
      note: 'WhatsApp is not configured on this deployment (set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID). The enquiry has been recorded.',
    }
  }

  const body = template
    ? {
      messaging_product: 'whatsapp',
      to: number,
      type: 'template',
      template: {
        name: template,
        language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? 'en_GB' },
        components: [{ type: 'body', parameters: [{ type: 'text', text }] }],
      },
    }
    : {
      messaging_product: 'whatsapp',
      to: number,
      type: 'text',
      text: { body: text, preview_url: false },
    }

  try {
    // A deadline, because this sits inside a request somebody is waiting on.
    // The enquiry is already saved by the time this runs, so a provider having
    // a slow morning must not turn into a button that appears to hang.
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${from}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      },
    )
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      logger.error('whatsapp send failed', { status: response.status, detail: detail.slice(0, 300) })
      return { sent: false, note: `WhatsApp refused the message (${response.status}).` }
    }
    return { sent: true, note: 'Relayed to WhatsApp.' }
  } catch (error) {
    logger.error('whatsapp send errored', { error: (error as Error).message })
    return { sent: false, note: 'WhatsApp could not be reached.' }
  }
}
