import { describe, expect, it } from 'vitest'

/**
 * Regression guard: a connection string copied from a managed Postgres
 * provider must be usable as-is.
 *
 * postgres.js forwards unrecognised query parameters to the server as startup
 * configuration, and Postgres rejects unknown ones outright. Neon's default
 * URL carries `channel_binding=require`, which made every connection fail with
 * `unrecognized configuration parameter "channel_binding"` — a total outage
 * that only appeared once deployed against a real provider.
 */
const CLIENT_ONLY_PARAMS = [
  'channel_binding', 'sslmode', 'connect_timeout', 'pgbouncer',
  'connection_limit', 'pool_timeout', 'schema', 'sslcert', 'sslkey', 'sslrootcert',
]

/** Mirrors the sanitiser in src/server/db/client.ts. */
function sanitise(raw: string): string {
  try {
    const url = new URL(raw)
    for (const param of CLIENT_ONLY_PARAMS) url.searchParams.delete(param)
    return url.toString()
  } catch {
    return raw
  }
}

describe('connection string sanitising', () => {
  it('strips the parameters Neon ships by default', () => {
    const neon = 'postgresql://user:pw@ep-x-pooler.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require'
    const result = sanitise(neon)
    expect(result).not.toContain('channel_binding')
    expect(result).not.toContain('sslmode')
    expect(result).toContain('ep-x-pooler.us-east-1.aws.neon.tech')
    expect(result).toContain('/neondb')
  })

  it('strips Prisma and pgbouncer parameters other tools add', () => {
    const result = sanitise('postgresql://u:p@host/db?pgbouncer=true&connection_limit=1&schema=public')
    expect(result).not.toContain('pgbouncer')
    expect(result).not.toContain('connection_limit')
    expect(result).not.toContain('schema')
  })

  it('preserves credentials, host, port and database', () => {
    const result = sanitise('postgresql://neondb_owner:secret@host.example.com:5432/neondb?sslmode=require')
    expect(result).toContain('neondb_owner:secret@')
    expect(result).toContain('host.example.com:5432')
    expect(result).toContain('/neondb')
  })

  it('keeps genuine server parameters', () => {
    expect(sanitise('postgresql://u:p@host/db?application_name=bluecroft')).toContain('application_name=bluecroft')
  })

  it('leaves an unparseable value untouched for the driver to report', () => {
    expect(sanitise('not a url')).toBe('not a url')
  })
})
