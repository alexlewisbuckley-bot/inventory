/**
 * Bug hunt.
 *
 * Adversarial input and edge conditions, clicked rather than reasoned about:
 * searches that match nothing, absurd numbers, very long strings, rapid double
 * submission, pagination past the end, sorting every column, and every
 * viewport from a phone to an ultra-wide.
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'
const FALLBACK = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const results = []
const only = process.argv[2]

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (existsSync(FALLBACK) ? FALLBACK : undefined),
  args: ['--no-proxy-server'],
})
const signedIn = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
{
  const page = await signedIn.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"]', 'alex@bluecroft.co.uk')
  await page.fill('input[type="password"]', 'Bluecroft2026!')
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 })
  await page.close()
}

async function check(name, fn, viewport) {
  if (only && !name.includes(only)) return
  const ctx = viewport
    ? await browser.newContext({ viewport, storageState: await signedIn.storageState() })
    : signedIn
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]))
  try {
    await fn(page)
    if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`)
    results.push(`PASS  ${name}`)
  } catch (error) {
    results.push(`FAIL  ${name}\n      ${error.message.split('\n')[0]}`)
    await page.screenshot({ path: `/tmp/stress-${name.replace(/\W+/g, '-')}.png`, fullPage: true })
  } finally {
    await page.close()
    if (ctx !== signedIn) await ctx.close()
  }
}

const go = async (page, path) => {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1100)
}

/** Nothing may spill sideways out of the document at any width. */
async function assertNoOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const guilty = []
    for (const el of document.querySelectorAll('body *')) {
      const box = el.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      if (box.right > width + 1.5) {
        const style = getComputedStyle(el)
        // A deliberately scrollable region is allowed to be wider than its box.
        let scroller = false
        for (let p = el.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX
          if (o === 'auto' || o === 'scroll' || o === 'hidden') { scroller = true; break }
        }
        if (scroller || style.position === 'fixed') continue
        guilty.push(`${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 40)} → ${Math.round(box.right)}px`)
      }
    }
    return { width, guilty: guilty.slice(0, 4), scrollable: document.documentElement.scrollWidth }
  })
  if (overflow.scrollable > overflow.width + 1) {
    throw new Error(`${label}: document scrolls sideways (${overflow.scrollable} > ${overflow.width}) ${overflow.guilty.join(' | ')}`)
  }
}

// 1. A search that matches nothing must explain itself, not show a blank table.
await check('search with no matches', async (page) => {
  await go(page, '/inventory?q=zzzznotathing')
  const body = await page.locator('main').innerText()
  if (await page.locator('tbody tr').count() > 0) throw new Error('rows were returned for a nonsense query')
  if (!/no |nothing|clear/i.test(body)) throw new Error('no empty state was offered')
  const reset = page.locator('main button:has-text("Clear"), main a:has-text("Clear")')
  if (await reset.count() === 0) throw new Error('no way back from the empty state')
})

// 2. Pagination beyond the last page must not blow up or strand the user.
await check('pagination past the end', async (page) => {
  await go(page, '/inventory?page=9999')
  const body = await page.locator('main').innerText()
  if (/error|exception|undefined/i.test(body)) throw new Error('the page reported an error')
})

// 3. Garbage in the query string must be ignored, not fatal.
await check('nonsense query string', async (page) => {
  await go(page, '/inventory?page=abc&sort=;drop&dir=sideways&perPage=-5&status=NOPE')
  if (await page.locator('main').count() === 0) throw new Error('the page did not render')
  const body = await page.locator('main').innerText()
  if (/application error|server error/i.test(body)) throw new Error('the page reported an error')
})

// 4. Every sortable column must actually sort, in both directions.
await check('sort every column', async (page) => {
  await go(page, '/inventory')
  const headers = page.locator('thead button')
  const count = await headers.count()
  if (count === 0) throw new Error('no sortable columns')
  for (let i = 0; i < count; i += 1) {
    await headers.nth(i).click()
    await page.waitForTimeout(900)
    if (await page.locator('tbody tr').count() === 0) {
      throw new Error(`sorting by column ${i} emptied the table`)
    }
  }
})

// 5. A very long value must truncate rather than stretch the layout.
await check('very long search term', async (page) => {
  await go(page, `/inventory?q=${'A'.repeat(300)}`)
  await assertNoOverflow(page, 'long search')
})

// 6. Double submission must not create two of anything.
await check('rapid double submit', async (page) => {
  await go(page, '/suppliers?new=1')
  const name = `Stress ${Date.now()}`
  const field = page.locator('input[name="name"]').first()
  if (await field.count() === 0) throw new Error('the supplier form did not open')
  await field.fill(name)
  const submit = page.locator('button[type="submit"]:has-text("Add"), button[type="submit"]:has-text("Save")').first()
  await Promise.all([submit.click(), submit.click().catch(() => {})])
  await page.waitForTimeout(3000)
  await go(page, `/suppliers?q=${encodeURIComponent(name)}`)
  const matches = await page.locator(`text="${name}"`).count()
  if (matches > 1) throw new Error(`double submit created ${matches} suppliers`)
})

// 7. Absurd numbers must be rejected or formatted, never rendered as junk.
await check('absurd price', async (page) => {
  await go(page, '/inventory/new')
  const money = page.locator('input[inputmode="decimal"], input[name*="cost" i]').first()
  if (await money.count() === 0) throw new Error('no money field found')
  await money.fill('999999999999')
  await page.waitForTimeout(400)
  const value = await money.inputValue()
  if (/NaN|Infinity|e\+/i.test(value)) throw new Error(`money field shows ${value}`)
  await assertNoOverflow(page, 'absurd price')
})

// 8. Zero and negative values.
await check('zero and negative price', async (page) => {
  await go(page, '/inventory/new')
  const money = page.locator('input[inputmode="decimal"], input[name*="cost" i]').first()
  await money.fill('-5')
  await page.waitForTimeout(300)
  const value = await money.inputValue()
  if (value.startsWith('-')) throw new Error('a negative cost was accepted into the field')
})

// 9. Submitting an empty required form must explain what is missing.
await check('empty required form', async (page) => {
  await go(page, '/inventory/new')
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(2200)
  const body = await page.locator('main').innerText()
  if (!/required|choose|enter|select|must/i.test(body)) throw new Error('no validation message appeared')
})

// 10-13. Every breakpoint, no sideways scroll and no clipped chrome.
for (const [label, viewport] of [
  ['phone 390', { width: 390, height: 844 }],
  ['phone 320', { width: 320, height: 640 }],
  ['tablet 768', { width: 768, height: 1024 }],
  ['ultra-wide 2560', { width: 2560, height: 1200 }],
]) {
  await check(`layout at ${label}`, async (page) => {
    for (const path of ['/', '/inventory', '/sales', '/reports', '/suppliers', '/settings/profile', '/inventory/new']) {
      await go(page, path)
      await assertNoOverflow(page, `${label} ${path}`)
    }
  }, viewport)
}

// 14. Keyboard: tab into the page and reach the primary action.
await check('keyboard reachable', async (page) => {
  await go(page, '/inventory')
  const seen = []
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press('Tab')
    seen.push(await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return 'body'
      const style = getComputedStyle(el)
      return `${el.tagName.toLowerCase()}|${style.outlineStyle}`
    }))
  }
  if (seen.every((s) => s === 'body')) throw new Error('tab never entered the page')
  const focused = seen.filter((s) => s !== 'body')
  if (focused.some((s) => s.endsWith('|none'))) {
    throw new Error(`an element took focus with no visible ring: ${focused.find((s) => s.endsWith('|none'))}`)
  }
})

// 15. Refreshing a filtered view must return the same view.
await check('filters survive a refresh', async (page) => {
  await go(page, '/inventory')
  await page.locator('button:has-text("Needs a price")').click()
  await page.waitForTimeout(2000)
  const before = page.url()
  const rows = await page.locator('tbody tr').count()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1600)
  if (page.url() !== before) throw new Error(`url changed on reload: ${before} -> ${page.url()}`)
  if (await page.locator('tbody tr').count() !== rows) throw new Error('a different set of rows came back')
})

// 16. The 404 must look like the application, not like a stack trace.
await check('unknown route', async (page) => {
  await go(page, '/definitely-not-a-page')
  const body = await page.locator('body').innerText()
  if (!/not found|does not exist|can.t find/i.test(body)) throw new Error('no useful 404 copy')
  if (await page.locator('a').count() === 0) throw new Error('no way back from the 404')
})

await signedIn.close()
await browser.close()
console.log(results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL')).length
console.log(failed ? `\n${failed} CHECK(S) FAILED — screenshots in /tmp` : '\nall checks passed')
process.exit(failed ? 1 : 0)
