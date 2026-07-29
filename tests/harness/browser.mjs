/**
 * One browser setup, shared by every harness.
 *
 * The three harnesses had three copies of the sign-in dance and they drifted:
 * one waited for `load` and hung whenever the app was slow, another used a
 * browser path that moves with the Playwright version.
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

export const BASE = process.env.HARNESS_URL ?? 'http://localhost:3000'
export const EMAIL = process.env.HARNESS_EMAIL ?? 'alex@bluecroft.co.uk'
export const PASSWORD = process.env.HARNESS_PASSWORD ?? 'Bluecroft2026!'

const FALLBACK = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

/** Every authenticated route, for sweeps that must cover the whole product. */
export const ROUTES = [
  '/', '/today', '/insights', '/inventory', '/inventory/new', '/inventory/import', '/sales',
  '/reports', '/reports/ageing', '/suppliers', '/locations', '/customers',
  '/pipeline', '/tasks', '/requests', '/notifications', '/help',
  '/settings', '/settings/currencies', '/settings/users', '/settings/audit',
  '/settings/profile',
]

export async function launch({ width = 1440, height = 1000, colorScheme } = {}) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH
      || (existsSync(FALLBACK) ? FALLBACK : undefined),
    args: ['--no-proxy-server'],
  })
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme,
  })
  return { browser, ctx }
}

/**
 * Sign in once; every page from this context inherits the session.
 *
 * Retries on the application's own rate limiter. A suite run repeatedly — in
 * CI, or while iterating — trips it, and a harness that fails because the
 * product is correctly defending itself is a harness nobody trusts.
 */
export async function signIn(ctx, { email = EMAIL, password = PASSWORD, attempt = 1 } = {}) {
  const page = await ctx.newPage()
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await page.fill('input[type="email"]', email)
    await page.fill('input[type="password"]', password)
    await page.click('button[type="submit"]')
    // `commit` rather than `load`: the app streams, and waiting for every
    // resource made this hang whenever a page was slow.
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
      timeout: 30_000, waitUntil: 'commit',
    })
  } catch (error) {
    const body = await page.locator('body').innerText().catch(() => '')
    const limited = /too many requests/i.test(body)
    await page.close()
    if (limited && attempt <= 3) {
      const wait = attempt * 45_000
      console.log(`rate limited — waiting ${wait / 1000}s (attempt ${attempt})`)
      await new Promise((resolve) => setTimeout(resolve, wait))
      return signIn(ctx, { email, password, attempt: attempt + 1 })
    }
    throw error
  }
  await page.close()
}
