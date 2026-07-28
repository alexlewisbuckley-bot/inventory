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
