import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { percentChange } from '@/components/dashboard/MetricTile'
import { monthSpine } from '@/server/repositories/dashboard-repository'

describe('percentChange', () => {
  it('reports the change against the prior period', () => {
    expect(percentChange(150, 100)).toBe(50)
    expect(percentChange(50, 100)).toBe(-50)
    expect(percentChange(100, 100)).toBe(0)
  })

  it('returns null rather than Infinity when there is no baseline', () => {
    // A first trading period has nothing to compare against. Rendering "+∞%"
    // or "+100%" would both be lies; the tile says "No prior period" instead.
    expect(percentChange(1200, 0)).toBeNull()
    expect(percentChange(0, 0)).toBeNull()
  })

  it('handles a negative baseline without flipping the sign of the change', () => {
    // A loss-making prior month must still read as an improvement when profit rises.
    expect(percentChange(-50, -100)).toBe(50)
  })
})

describe('monthSpine', () => {
  it('returns one entry per month, oldest first, ending on the anchor month', () => {
    const spine = monthSpine(new Date(Date.UTC(2026, 1, 1)), 6)
    expect(spine.map((m) => m.month)).toEqual([
      '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
    ])
  })

  it('crosses a year boundary correctly', () => {
    const spine = monthSpine(new Date(Date.UTC(2025, 10, 1)), 4)
    expect(spine.map((m) => m.month)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })

  it('labels months in a form a UK reader expects', () => {
    expect(monthSpine(new Date(Date.UTC(2026, 0, 1)), 1)[0].label).toBe('Jan')
  })
})

/**
 * Guard against binding a JavaScript Date inside a raw SQL fragment.
 *
 * Drizzle serialises Dates for its own comparison helpers, but a Date
 * interpolated into a hand-written `sql` template reaches postgres.js
 * untranslated and throws ERR_INVALID_ARG_TYPE at query time. Nothing catches
 * it — types pass, the build passes, and the page 500s in production. Every
 * such boundary must be bound as ISO text with an explicit cast.
 */
describe('raw SQL date binding', () => {
  const files = sourceFiles(join(process.cwd(), 'src', 'server'))

  it('finds server source files to check', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it('never interpolates a Date-valued variable into a sql template without a cast', () => {
    const offenders: string[] = []

    for (const file of files) {
      const source = readFileSync(file, 'utf8')

      // Locals whose value is a Date instance.
      const dateLocals = new Set<string>()
      for (const match of source.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*new Date\(/g)) {
        dateLocals.add(match[1])
      }
      if (dateLocals.size === 0) continue

      for (const fragment of source.matchAll(/sql(?:<[^>]*>)?`([^`]*)`/g)) {
        const body = fragment[1]
        for (const name of dateLocals) {
          const interpolation = new RegExp(`\\$\\{${name}\\}(?!::)`)
          if (interpolation.test(body)) {
            offenders.push(`${file.replace(process.cwd() + '/', '')} binds Date "${name}" without ::timestamptz`)
          }
        }
      }
    }

    expect(offenders).toEqual([])
  })
})

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      sourceFiles(path, acc)
    } else if (/\.tsx?$/.test(entry)) {
      acc.push(path)
    }
  }
  return acc
}
