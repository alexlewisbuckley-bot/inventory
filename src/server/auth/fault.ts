/**
 * Why sign-in failed, when it was not the password.
 *
 * A wrong password is answered by the service with a sentence the person can
 * act on. Everything else — the database refusing connections, a rotated
 * secret, a migration that did not land — arrived at the form as one line:
 * "Something went wrong signing you in. Please try again."
 *
 * During an outage that line is actively harmful. It names the person's own
 * credentials as the likely cause, so the owner of the business retypes a
 * password that was never wrong, concludes they have been locked out of their
 * own system, and has nothing to tell anyone who could fix it. The fault was
 * legible the whole time: it was in the thrown error, and we discarded it.
 *
 * So classify it. The person is told, in plain words, that the fault is ours
 * and not theirs, and is given a short code to quote. The code is the only
 * detail that crosses to the browser — never the driver's message, which can
 * carry a host name or a connection string.
 */

/** A fault the sign-in form can report without saying anything it shouldn't. */
export interface SignInFault {
  /** Quotable, stable, and safe to read out over the phone. */
  code: string
  /** Shown on the form. Written for the person locked out, not for a log. */
  message: string
  /**
   * Whether retrying could plausibly work. A connection that timed out may
   * succeed a moment later; a database that does not exist will not.
   */
  transient: boolean
}

/**
 * Connectivity failures, by the code postgres.js and Node actually set.
 *
 * These are the ones that produce the reported symptom — the login page
 * renders, because rendering it needs no database, and the submit then
 * throws.
 */
const UNREACHABLE = new Set([
  'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED',
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE',
])

/**
 * Postgres server-side states worth telling apart, by SQLSTATE.
 *
 * Each of these has a different person fixing it, which is the whole reason
 * to distinguish them: too many connections is waited out, a rejected
 * password is an environment variable, a missing column is a migration.
 */
const SQLSTATE: Record<string, Omit<SignInFault, 'code'>> = {
  // Connection limit reached. Common on serverless against a small instance,
  // and the one case here that genuinely clears on its own.
  '53300': {
    message:
      'The system has run out of database connections. This is not your password — ' +
      'wait a minute and sign in again.',
    transient: true,
  },
  '53400': { message: 'The database is out of resources. This is not your password.', transient: true },
  // Shut down under us, or still coming up.
  '57P01': { message: 'The database is restarting. This is not your password — try again shortly.', transient: true },
  '57P03': { message: 'The database is still starting up. This is not your password — try again shortly.', transient: true },
  '08006': { message: 'The connection to the database failed. This is not your password.', transient: true },
  '08003': { message: 'The connection to the database failed. This is not your password.', transient: true },
  // Credentials in the environment, not the person's.
  '28P01': {
    message:
      'The system\'s own database credentials were rejected. This is not your password — ' +
      'DATABASE_URL needs updating before anyone can sign in.',
    transient: false,
  },
  '28000': {
    message:
      'The system\'s own database credentials were rejected. This is not your password — ' +
      'DATABASE_URL needs updating before anyone can sign in.',
    transient: false,
  },
  '3D000': {
    message:
      'The system is pointed at a database that does not exist. This is not your password — ' +
      'DATABASE_URL needs correcting.',
    transient: false,
  },
  // Schema behind the code: a migration did not run on the last deploy.
  '42P01': {
    message:
      'The database is missing part of its schema, so sign-in cannot complete. ' +
      'This is not your password — the last deployment\'s migrations need to be run.',
    transient: false,
  },
  '42703': {
    message:
      'The database is missing part of its schema, so sign-in cannot complete. ' +
      'This is not your password — the last deployment\'s migrations need to be run.',
    transient: false,
  },
}

/** The error's `code`, where the thing thrown carries one. */
function codeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : ''

/**
 * Classify a non-application error thrown out of the sign-in path.
 *
 * Always returns something safe to display. An unrecognised fault keeps the
 * old wording, because inventing a cause would be worse than admitting we do
 * not know one.
 */
export function describeSignInFault(error: unknown): SignInFault {
  const code = codeOf(error)
  const text = messageOf(error)

  if (code && SQLSTATE[code]) return { code: `DB-${code}`, ...SQLSTATE[code]! }

  if (code && UNREACHABLE.has(code)) {
    return {
      code: `DB-${code}`,
      message:
        'The system cannot reach its database, so nobody can sign in. ' +
        'This is not your password. Open /api/health to confirm.',
      transient: true,
    }
  }

  // Thrown by hand in session.ts and db/client.ts when the deployment is
  // missing the variables it needs. Matched on the text because that is all
  // a plain Error gives us — but these two strings are ours, not a driver's.
  if (/^AUTH_SECRET must be set/.test(text)) {
    return {
      code: 'CONFIG-AUTH_SECRET',
      message:
        'The system is missing its session signing key, so no sign-in can be issued. ' +
        'This is not your password — AUTH_SECRET needs setting on the deployment.',
      transient: false,
    }
  }
  if (/^DATABASE_URL is not set/.test(text)) {
    return {
      code: 'CONFIG-DATABASE_URL',
      message:
        'The system has no database configured. This is not your password — ' +
        'DATABASE_URL needs setting on the deployment.',
      transient: false,
    }
  }

  return {
    code: 'UNKNOWN',
    message: 'Something went wrong signing you in. Please try again.',
    transient: true,
  }
}
