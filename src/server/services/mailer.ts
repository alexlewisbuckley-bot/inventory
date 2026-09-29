import { logger } from '@/lib/logger'

/**
 * Sending email, over HTTP, with no dependency.
 *
 * Resend's REST API is a single POST, so this is `fetch` rather than a
 * package: an SMTP client pulled in for one message is a lot of surface for
 * very little, and this way the build has nothing new to install.
 *
 * Unconfigured is a supported state, not an error. The application is a
 * prototype and nobody has set a key yet; the callers here write what they are
 * sending to the database first and treat delivery as something that may or
 * may not have happened. Returning "not configured" lets that be recorded
 * plainly instead of being reported as a failure somebody would go looking for.
 */
export interface MailResult {
  sent: boolean
  note: string
}

export interface Mail {
  to: string
  replyTo?: string
  subject: string
  /** Plain text. No template engine, and nothing that renders as markup. */
  text: string
}

export function mailIsConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM)
}

export async function sendMail(mail: Mail): Promise<MailResult> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM

  if (!key || !from) {
    logger.warn('mail not configured; message recorded but not sent', { to: mail.to, subject: mail.subject })
    return {
      sent: false,
      note: 'Email is not configured on this deployment (set RESEND_API_KEY and MAIL_FROM). The enquiry has been recorded.',
    }
  }

  try {
    // A deadline, because this sits inside a request a customer is waiting on.
    // A provider having a slow morning must not turn into a form that appears
    // to hang; the enquiry is already saved by the time this runs.
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    })

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300)
      logger.error('mail send rejected', { status: response.status, detail })
      return { sent: false, note: `The mail provider refused it (${response.status}).` }
    }

    logger.info('mail sent', { to: mail.to, subject: mail.subject })
    return { sent: true, note: 'Delivered to the mail provider.' }
  } catch (error) {
    logger.error('mail send threw', { error: (error as Error).message })
    return { sent: false, note: `Could not reach the mail provider: ${(error as Error).message}` }
  }
}
