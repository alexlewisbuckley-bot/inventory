import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword, assessPassword } from '@/server/auth/password'

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('Bluecroft2026!')
    expect(await verifyPassword('Bluecroft2026!', hash)).toBe(true)
    expect(await verifyPassword('Bluecroft2026', hash)).toBe(false)
  }, 20_000)

  it('salts, so the same password hashes differently each time', async () => {
    const [a, b] = await Promise.all([hashPassword('SamePassword1'), hashPassword('SamePassword1')])
    expect(a).not.toBe(b)
  }, 20_000)

  it('fails closed on a malformed stored hash', async () => {
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false)
    expect(await verifyPassword('anything', '')).toBe(false)
  })
})

describe('password policy', () => {
  it('requires length, mixed case and a digit', () => {
    expect(assessPassword('short1A').valid).toBe(false)
    expect(assessPassword('alllowercase1').valid).toBe(false)
    expect(assessPassword('ALLUPPERCASE1').valid).toBe(false)
    expect(assessPassword('NoDigitsHere').valid).toBe(false)
    expect(assessPassword('ValidPassw0rd').valid).toBe(true)
  })

  it('rejects a password containing the user’s own identity', () => {
    expect(assessPassword('Alexbuckley123', ['alex@bluecroft.co.uk']).valid).toBe(false)
  })
})
