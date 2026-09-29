/** Discriminated application errors mapped to HTTP status codes at the API edge. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The submitted data is invalid.', details?: unknown) {
    super(message, 422, 'VALIDATION_ERROR', details)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'You must be signed in to do that.') {
    super(message, 401, 'UNAUTHORIZED')
  }
}

export class ForbiddenError extends AppError {
  /**
   * Next.js strips a server error's message before it reaches the client and
   * substitutes a random digest — correct for a stack trace, wrong for "you
   * are not allowed in here", which the person is supposed to read. Setting
   * `digest` ourselves survives the stripping, so the error boundary can tell
   * a refusal from a crash and say so instead of "something went wrong,
   * try again" — which, for a permission refusal, is untrue twice.
   */
  readonly digest = 'FORBIDDEN'

  constructor(message = 'You do not have permission to do that.') {
    super(message, 403, 'FORBIDDEN')
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} could not be found.`, 404, 'NOT_FOUND')
  }
}

export class ConflictError extends AppError {
  constructor(message = 'That change conflicts with existing data.', details?: unknown) {
    super(message, 409, 'CONFLICT', details)
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSeconds: number) {
    super('Too many requests. Please slow down.', 429, 'RATE_LIMITED', { retryAfterSeconds })
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/**
 * A database constraint, in words the person can act on.
 *
 * A unique violation reaching a form as "Could not save" tells somebody
 * nothing: they cannot see the row they are colliding with, and on a
 * soft-deleted record they cannot see it at all. Postgres names the index it
 * refused on, which is enough to say what was duplicated.
 *
 * Only the constraints a person can actually hit from a form are translated.
 * Anything else stays generic on purpose — an index name is a detail of the
 * schema, not something to show.
 */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  resellers_slug_idx: 'A reseller with that name already exists.',
  owners_slug_idx: 'An owner with that name already exists.',
  locations_slug_idx: 'A location with that name already exists.',
  suppliers_name_idx: 'A supplier with that name already exists.',
  brands_slug_idx: 'A brand with that name already exists.',
  watches_serial_idx: 'That serial number is already in stock.',
}

export function describeDbError(error: unknown): string | null {
  const code = (error as { code?: string } | null)?.code
  if (code !== '23505') return null
  const constraint = (error as { constraint_name?: string; constraint?: string }).constraint_name
    ?? (error as { constraint?: string }).constraint
  if (constraint && CONSTRAINT_MESSAGES[constraint]) return CONSTRAINT_MESSAGES[constraint]
  return 'Something with that name already exists.'
}
