import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every authenticated page names who may open it.
 *
 * Written after Help was found serving a trade partner a description of how
 * we book stock in from a supplier invoice, move it between stores and void a
 * sale, plus every keyboard shortcut for suppliers, locations and reports. It
 * had no guard at all — not a wrong one, none — because "any signed-in user"
 * was true when the only signed-in users were staff, and stayed in the file
 * after that stopped being true.
 *
 * A grep, not a runtime check, because the failure it catches is a page
 * someone adds next year without thinking about the question. It can only
 * ever be evidence that the words appear; that the guard is the right one is
 * what the role matrix and the payload tests are for.
 */
const APP = join(process.cwd(), 'src/app/(app)')

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return pages(full)
    return entry === 'page.tsx' ? [full] : []
  })
}

describe('authenticated routes', () => {
  const found = pages(APP)

  it('finds the pages at all', () => {
    // Guards against the sweep silently passing because it looked nowhere.
    expect(found.length).toBeGreaterThan(20)
  })

  it('asks who the reader is on every page', () => {
    const unguarded = found
      .filter((file) => {
        const source = readFileSync(file, 'utf8')
        return !/requireCapability\(|requireStaff\(|requireUser\(/.test(source)
      })
      .map((file) => file.slice(APP.length))
    expect(unguarded, 'these pages let anybody with a session in').toEqual([])
  })

  it('lets nothing but a capability or a staff check stand between an outside party and a page', () => {
    // `requireUser` only proves somebody is signed in, which a trade partner
    // is. The three places it is still right are their own account, their own
    // notifications, and the page that decides where to send them.
    const BARE_USER_IS_FINE = ['/settings/profile/page.tsx', '/page.tsx']
    const bare = found
      .filter((file) => {
        const source = readFileSync(file, 'utf8')
        return /requireUser\(/.test(source)
          && !/requireCapability\(|requireStaff\(/.test(source)
      })
      .map((file) => file.slice(APP.length))
      .filter((path) => !BARE_USER_IS_FINE.includes(path))
    expect(bare, 'these pages are open to any signed-in user, staff or not').toEqual([])
  })
})
