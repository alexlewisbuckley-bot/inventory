import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { describeSignInFault } from '@/server/auth/fault'
import { AppError, RateLimitError, waitFor } from '@/lib/errors'

/**
 * The symptom these exist for: the owner of the business was shown
 * "Something went wrong signing you in. Please try again." during a database
 * outage, and spent the time retyping a password that had never been wrong.
 *
 * Every case below therefore asserts two things — that the fault is named,
 * and that the person is told it is not their password.
 */

/** What postgres.js and Node actually throw: a plain Error carrying `code`. */
function driverError(code: string, message = 'connection failure'): Error {
  return Object.assign(new Error(message), { code })
}

describe('describeSignInFault', () => {
  it('names an unreachable database and absolves the password', () => {
    const fault = describeSignInFault(driverError('CONNECT_TIMEOUT'))
    expect(fault.code).toBe('DB-CONNECT_TIMEOUT')
    expect(fault.message).toMatch(/not your password/i)
    expect(fault.transient).toBe(true)
  })

  it.each([
    'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED',
    'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE',
  ])('treats %s as unreachable rather than unknown', (code) => {
    const fault = describeSignInFault(driverError(code))
    expect(fault.code).toBe(`DB-${code}`)
    expect(fault.message).toMatch(/not your password/i)
  })

  it('tells someone to wait when the connection pool is exhausted', () => {
    const fault = describeSignInFault(driverError('53300', 'too many connections for role'))
    expect(fault.code).toBe('DB-53300')
    expect(fault.message).toMatch(/run out of database connections/i)
    expect(fault.transient).toBe(true)
  })

  it('points at DATABASE_URL when the database rejects our own credentials', () => {
    const fault = describeSignInFault(driverError('28P01', 'password authentication failed'))
    expect(fault.code).toBe('DB-28P01')
    expect(fault.message).toContain('DATABASE_URL')
    // Nothing anybody can wait out — saying "try again" here wastes the outage.
    expect(fault.transient).toBe(false)
  })

  it('points at migrations when the schema is behind the code', () => {
    for (const code of ['42P01', '42703']) {
      const fault = describeSignInFault(driverError(code, 'column users.x does not exist'))
      expect(fault.message).toMatch(/migrations/i)
      expect(fault.transient).toBe(false)
    }
  })

  it('recognises a restarting database as worth retrying', () => {
    expect(describeSignInFault(driverError('57P03')).transient).toBe(true)
  })

  it('recognises our own missing-configuration errors by their wording', () => {
    const secret = describeSignInFault(
      new Error('AUTH_SECRET must be set to at least 32 characters. See .env.example.'),
    )
    expect(secret.code).toBe('CONFIG-AUTH_SECRET')
    expect(secret.message).toContain('AUTH_SECRET')

    const url = describeSignInFault(new Error('DATABASE_URL is not set. Copy .env.example to .env'))
    expect(url.code).toBe('CONFIG-DATABASE_URL')
    expect(url.message).toContain('DATABASE_URL')
  })

  it('keeps the old wording for a fault it cannot explain', () => {
    const fault = describeSignInFault(new Error('something nobody has seen before'))
    expect(fault.code).toBe('UNKNOWN')
    expect(fault.message).toBe('Something went wrong signing you in. Please try again.')
  })

  it('survives being handed something that is not an Error at all', () => {
    for (const thrown of [null, undefined, 'a string', 42, {}]) {
      expect(() => describeSignInFault(thrown)).not.toThrow()
      expect(describeSignInFault(thrown).code).toBe('UNKNOWN')
    }
  })

  it('never puts the driver\'s own message in front of the person', () => {
    // A driver message can carry the host, the user and the database name.
    const leaky = driverError(
      'ECONNREFUSED',
      'connect ECONNREFUSED 10.0.0.4:5432 for user "osw_admin" on db "osw_prod"',
    )
    const fault = describeSignInFault(leaky)
    expect(fault.message).not.toContain('10.0.0.4')
    expect(fault.message).not.toContain('osw_admin')
    expect(fault.message).not.toContain('osw_prod')
  })
})

describe('the login action reports the fault it classified', () => {
  const source = readFileSync('src/app/actions/auth.ts', 'utf8')

  it('classifies rather than falling back to one fixed sentence', () => {
    expect(source).toContain('describeSignInFault')
    // The old hard-coded string must not be the action's only answer.
    expect(source).not.toMatch(
      /return \{ ok: false, message: 'Something went wrong signing you in\. Please try again\.' \}/,
    )
  })

  it('puts the quotable code on the screen with the message', () => {
    expect(source).toMatch(/\$\{fault\.message\}.*\$\{fault\.code\}/)
  })

  it('still answers an application error with its own message', () => {
    // A wrong password must keep reading as a wrong password.
    expect(source).toMatch(/if \(isAppError\(error\)\) return \{ ok: false, message: error\.message \}/)
  })

  it('logs the fault code alongside the underlying error', () => {
    expect(source).toMatch(/fault: fault\.code/)
    expect(source).toMatch(/logger\.error\('login action failed'/)
  })
})

describe('a rate-limited person is told how long to wait', () => {
  it('turns seconds into a wait anybody can act on', () => {
    expect(waitFor(1)).toBe('about a minute')
    expect(waitFor(60)).toBe('about a minute')
    expect(waitFor(61)).toBe('about 2 minutes')
    expect(waitFor(540)).toBe('about 9 minutes')
    // Rounded up: refusing somebody at 59 seconds of a "one minute" wait is
    // the same failure over again.
    expect(waitFor(541)).toBe('about 10 minutes')
  })

  it('puts the wait in the message, not only in the details', () => {
    const error = new RateLimitError(540)
    expect(error.message).toBe('Too many attempts. Please wait about 9 minutes and try again.')
    // "Please slow down" was advice nobody could follow.
    expect(error.message).not.toMatch(/slow down/i)
    expect(error.status).toBe(429)
    expect(error.details).toEqual({ retryAfterSeconds: 540 })
  })

  it('is still an application error, so the form shows it rather than a crash', () => {
    // A lockout must never reach the catch-all and read as "something went wrong".
    expect(describeSignInFault(new RateLimitError(60)).code).toBe('UNKNOWN')
    expect(new RateLimitError(60)).toBeInstanceOf(AppError)
  })
})

describe('the health probe names the failure it found', () => {
  const client = readFileSync('src/server/db/client.ts', 'utf8')
  const route = readFileSync('src/app/api/health/route.ts', 'utf8')

  it('carries the driver code out of checkDatabase', () => {
    expect(client).toMatch(/checkDatabase\(\): Promise<\{ ok: boolean; migrated: boolean; code\?: string \}>/)
    expect(client).toMatch(/return \{ ok: false, migrated: false, code \}/)
  })

  it('reports that code on an unhealthy response', () => {
    expect(route).toMatch(/const \{ ok, migrated, code \} = await checkDatabase\(\)/)
    expect(route).toMatch(/database: 'unreachable',\s*\n(\s*\/\/.*\n)*\s*code,/)
  })

  it('never puts the driver\'s message on a public endpoint', () => {
    // The code is safe to publish; the message can name a host, role and database.
    expect(route).not.toMatch(/error\)\.message/)
    expect(route).not.toMatch(/\bmessage:\s*\(/)
  })

  it('leaves a healthy response alone', () => {
    // No code field when there is no fault — the shape other callers rely on.
    expect(route).toMatch(/status: 'ok', database: 'ok'/)
  })
})
