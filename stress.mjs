/**
 * Break it on purpose.
 *
 * Long strings, zero and huge numbers, blank submits, double submits, rapid
 * clicking, nonsense URLs, sort and filter combinations, keyboard-only paths.
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'
const results = []
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-proxy-server'],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
{
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await p.fill('input[type="email"]', 'alex@bluecroft.co.uk')
  await p.fill('input[type="password"]', 'Bluecroft2026!')
  await p.click('button[type="submit"]')
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 })
  await p.close()
}

async function check(name, fn) {
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]))
  try {
    const note = await fn(page)
    if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`)
    results.push(`PASS  ${name}${note ? ` — ${note}` : ''}`)
  } catch (error) {
    results.push(`FAIL  ${name}\n      ${error.message.split('\n')[0]}`)
    await page.screenshot({ path: `/tmp/qa/stress-${name.replace(/\W+/g, '-')}.png`, fullPage: true })
  } finally {
    await page.close()
  }
}

const go = async (page, path) => {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1100)
}
const overflows = (page) => page.evaluate(() =>
  document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    ? `document ${document.documentElement.scrollWidth} vs ${document.documentElement.clientWidth}`
    : null)

const LONG = 'Patek Philippe Nautilus Perpetual Calendar Chronograph Reference '.repeat(4)

await check('very long text does not break the form', async (page) => {
  await go(page, '/inventory/new')
  await page.fill('input[name="model"]', LONG)
  await page.fill('input[name="serial"]', LONG)
  const bad = await overflows(page)
  if (bad) throw new Error(bad)
  return 'no overflow'
})

await check('blank submit reports every missing field', async (page) => {
  await go(page, '/inventory/new')
  await page.click('button:has-text("Add watch to stock")')
  await page.waitForTimeout(2000)
  const text = await page.locator('body').innerText()
  if (!/required|choose/i.test(text)) throw new Error('no validation feedback at all')
  if (page.url().includes('/inventory') && !page.url().includes('/new')) {
    throw new Error('an empty form was accepted')
  }
  return 'rejected with messages'
})

await check('zero and huge amounts', async (page) => {
  await go(page, '/inventory/new')
  const money = page.locator('input[name="purchaseAmount"]')
  await money.fill('0')
  if (await money.inputValue() !== '0') throw new Error(`zero became "${await money.inputValue()}"`)
  await money.fill('999999999999')
  const huge = await money.inputValue()
  if (!huge.includes(',')) throw new Error(`large number not grouped: ${huge}`)
  const bad = await overflows(page)
  if (bad) throw new Error(bad)
  return `0 kept, ${huge} grouped`
})

await check('double submit does not double up', async (page) => {
  await go(page, '/suppliers')
  await page.locator('button:has-text("Add supplier")').first().click()
  await page.waitForTimeout(500)
  const name = `Stress ${Date.now().toString().slice(-6)}`
  await page.fill('input[name="name"]', name)
  const submit = page.locator('[role="dialog"] button[type="submit"]')
  await submit.click()
  await submit.click({ force: true }).catch(() => {})
  await page.waitForTimeout(3500)
  await go(page, '/suppliers')
  const count = await page.locator(`tr:has-text("${name}")`).count()
  if (count > 1) throw new Error(`created ${count} times`)
  return `${count} row`
})

await check('rapid clicking a status menu', async (page) => {
  await go(page, '/inventory')
  const trigger = page.locator('button[aria-label^="Status:"]').first()
  for (let i = 0; i < 8; i += 1) await trigger.click({ delay: 20 })
  await page.waitForTimeout(600)
  const menus = await page.locator('[role="menu"]').count()
  if (menus > 1) throw new Error(`${menus} menus open at once`)
  return `${menus} menu`
})

await check('search for something that does not exist', async (page) => {
  await go(page, '/inventory?q=zzzzzzzznothing')
  const text = await page.locator('body').innerText()
  if (!/no |nothing|match/i.test(text)) throw new Error('no empty state shown')
  if (await page.locator('tbody tr').count() > 0) throw new Error('rows shown for a non-matching search')
  return 'empty state'
})

await check('every sort key and direction', async (page) => {
  const keys = ['stockNo', 'model', 'purchaseDate', 'purchasePriceGbp', 'estSaleUsd', 'status', 'location', 'margin']
  for (const key of keys) {
    for (const dir of ['asc', 'desc']) {
      const res = await page.goto(`${BASE}/inventory?sort=${key}&dir=${dir}`, { waitUntil: 'domcontentloaded' })
      if (res.status() >= 400) throw new Error(`${key} ${dir} -> HTTP ${res.status()}`)
    }
  }
  return `${keys.length * 2} combinations`
})

await check('pagination edge cases', async (page) => {
  for (const url of ['/inventory?page=0', '/inventory?page=-3', '/inventory?page=99999',
                     '/inventory?perPage=0', '/inventory?perPage=100000', '/inventory?page=abc']) {
    const res = await page.goto(BASE + url, { waitUntil: 'domcontentloaded' })
    if (res.status() >= 400) throw new Error(`${url} -> HTTP ${res.status()}`)
    await page.waitForTimeout(300)
  }
  return '6 URLs survived'
})

await check('nonsense query parameters', async (page) => {
  for (const url of ['/inventory?status=NOPE', '/inventory?sort=;DROP', '/sales?from=notadate',
                     '/inventory?locationId=<script>', '/settings/audit?action=BOGUS']) {
    const res = await page.goto(BASE + url, { waitUntil: 'domcontentloaded' })
    if (res.status() >= 500) throw new Error(`${url} -> HTTP ${res.status()}`)
    await page.waitForTimeout(300)
  }
  return '5 URLs survived'
})

await check('a record that does not exist', async (page) => {
  await go(page, '/inventory/wch_does_not_exist')
  const text = await page.locator('body').innerText()
  if (!/can.t find|not found|does not exist/i.test(text)) throw new Error('no explanation shown')
  // The way back matters more than the status line: a dead link should not
  // strand somebody outside the application.
  if (await page.locator('nav[aria-label="Main"]').count() === 0) {
    throw new Error('the not-found page loses the navigation')
  }
  if (await page.locator('a[href="/inventory"]').count() === 0) throw new Error('no way back offered')
  return 'explained, navigation intact'
})

await check('keyboard only: tab to the first action and use it', async (page) => {
  await go(page, '/inventory')
  let reachedSearch = false
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press('Tab')
    const label = await page.evaluate(() => {
      const el = document.activeElement
      return el ? (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40) : ''
    })
    if (/search inventory/i.test(label)) { reachedSearch = true; break }
  }
  if (!reachedSearch) throw new Error('could not reach the search box with Tab')
  await page.keyboard.type('126711')
  await page.waitForTimeout(2000)
  const rows = await page.locator('tbody tr').count()
  if (rows === 0) throw new Error('typing in the focused search returned nothing')
  return `search reachable, ${rows} result(s)`
})

await check('escape closes an open dialog', async (page) => {
  await go(page, '/suppliers')
  await page.locator('button:has-text("Add supplier")').first().click()
  await page.waitForTimeout(500)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  if (await page.locator('[role="dialog"]').count() > 0) throw new Error('Escape did not close the dialog')
  return 'closed'
})

await check('ultra-wide does not strand the content', async () => {
  const wide = await browser.newContext({ viewport: { width: 2560, height: 1200 }, storageState: await ctx.storageState() })
  const page = await wide.newPage()
  await page.goto(`${BASE}/inventory`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const box = await page.locator('main').boundingBox()
  await page.screenshot({ path: '/tmp/qa/ultrawide.png' })
  await wide.close()
  if (box.width > 1600) throw new Error(`content runs to ${Math.round(box.width)}px with no measure`)
  return `${Math.round(box.width)}px measure`
})

await check('tablet width', async () => {
  const tab = await browser.newContext({ viewport: { width: 834, height: 1112 }, storageState: await ctx.storageState() })
  const page = await tab.newPage()
  for (const url of ['/', '/inventory', '/sales', '/reports', '/suppliers', '/settings']) {
    await page.goto(BASE + url, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(900)
    const bad = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    if (bad) { await page.screenshot({ path: '/tmp/qa/tablet-overflow.png', fullPage: true }); throw new Error(`${url} overflows at 834px`) }
  }
  await tab.close()
  return '6 pages fit'
})

await browser.close()
console.log(results.join('\n'))
console.log(results.some((r) => r.startsWith('FAIL')) ? '\nFAILURES ABOVE' : '\nall stress checks passed')
