'use server'
import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/server/auth/session'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { bookInInvoice, MAX_INVOICE_BYTES, type InvoiceIntakeResult } from '@/server/services/invoice-service'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'

export interface InvoiceActionState {
  ok: boolean
  message?: string
  result?: InvoiceIntakeResult
}

/**
 * Book stock in from a dropped invoice.
 *
 * One call does the whole thing — read, resolve the supplier, create the
 * stock — because the feature is the absence of steps. The result comes back
 * in full rather than as a redirect so the page can say exactly what it did:
 * which watches exist now, which supplier they went against, and what it could
 * not read.
 */
export async function bookInInvoiceAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const actor = await requireCapability('data:import')
  rateLimit({ key: `invoice:${actor.id}`, ...LIMITS.import })

  const file = formData.get('invoice')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Choose an invoice, or drop one onto the page.' }
  }
  if (file.size > MAX_INVOICE_BYTES) {
    return { ok: false, message: 'That file is over 12 MB. Send the invoice on its own rather than a scanned bundle.' }
  }

  try {
    const result = await bookInInvoice(
      {
        name: file.name,
        // Browsers send an empty type for some drag sources; fall back to the
        // extension rather than refusing a perfectly good PDF.
        mimeType: file.type || guessType(file.name),
        buffer: await file.arrayBuffer(),
      },
      actor,
    )

    revalidatePath('/inventory')
    revalidatePath('/suppliers')
    revalidatePath('/')

    return {
      ok: true,
      message: `${result.created.length} booked in from ${result.supplierName}.`,
      result,
    }
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message }
    logger.error('invoice intake failed', { error: (error as Error).message })
    return { ok: false, message: 'That invoice could not be read. Try the PDF as sent, rather than a printout of it.' }
  }
}

function guessType(name: string): string {
  const extension = name.toLowerCase().split('.').pop() ?? ''
  switch (extension) {
    case 'pdf': return 'application/pdf'
    case 'png': return 'image/png'
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'csv': return 'text/csv'
    case 'txt': return 'text/plain'
    default: return 'application/octet-stream'
  }
}
