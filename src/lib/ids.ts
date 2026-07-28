import { randomBytes } from 'node:crypto'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * Sortable, collision-resistant identifier: a base-36 millisecond timestamp
 * followed by 12 random characters. Lexical order matches creation order,
 * which keeps index locality good on `id` primary keys.
 */
export function newId(prefix?: string): string {
  const time = Date.now().toString(36).padStart(9, '0')
  const bytes = randomBytes(12)
  let random = ''
  for (let i = 0; i < bytes.length; i += 1) random += ALPHABET[bytes[i]! % ALPHABET.length]
  const id = `${time}${random}`
  return prefix ? `${prefix}_${id}` : id
}

/** URL/database-friendly slug. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/** Two-letter initials for avatar chips. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}
