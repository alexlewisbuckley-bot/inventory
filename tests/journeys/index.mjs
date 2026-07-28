/**
 * User journeys, clicked end to end against a running application.
 *
 *   npm run build && npm start
 *   npm run test:journeys
 *
 * Why this exists as well as the unit tests: three controls shipped that
 * rendered perfectly, typechecked, passed every unit test, and did nothing when
 * clicked. A menu was portalled out of its trigger, so the dismiss handler
 * closed it on mousedown and the click landed on nothing. A screenshot of the
 * open menu proved only that the menu opened.
 *
 * Every journey below therefore ends by asserting a change a person could see —
 * a status that moved, a sale in the ledger, a row that came back after undo —
 * and every one is written to survive being run twice, because a suite you
 * cannot re-run is a suite nobody runs.
 *
 * Signs in through the login form rather than minting a token, so the session
 * path is covered too.
 */
import { chromium } from 'playwright'

const BASE = process.env.JOURNEY_URL ?? 'http://localhost:3000'
const EMAIL = process.env.JOURNEY_EMAIL ?? 'alex@bluecroft.co.uk'
const PASSWORD = process.env.JOURNEY_PASSWORD ?? 'Bluecroft2026!'
const only = process.argv[2]
const results = []

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-proxy-server'],
})

/** One signed-in browser context, reused so the login runs once. */
const signedIn = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
{
  const page = await signedIn.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 })
  await page.close()
}

async function newPage(width = 1440, height = 1000) {
  const ctx = width === 1440
    ? signedIn
    : await browser.newContext({
      viewport: { width, height },
      storageState: await signedIn.storageState(),
    })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]))
  page.errors = errors
  return { ctx, page, shared: ctx === signedIn }
}

async function journey(name, fn) {
  if (only && !name.includes(only)) return
  const { ctx, page, shared } = await newPage()
  try {
    await fn(page)
    if (page.errors.length) throw new Error(`page errors: ${page.errors.join('; ')}`)
    results.push(`PASS  ${name}`)
  } catch (error) {
    results.push(`FAIL  ${name}\n      ${error.message.split('\n')[0]}`)
    await page.screenshot({ path: `/tmp/journey-fail-${name.replace(/\W+/g, '-')}.png`, fullPage: true })
  } finally {
    await page.close()
    if (!shared) await ctx.close()
  }
}

const go = async (page, path) => {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
}

/** The status chip for a given stock number. */
const statusButton = (page, stockNo) =>
  page.locator(`tr:has(td:text-is("${stockNo}")) button[aria-label^="Status:"]`)

// --- 1. Change a status from the row menu ----------------------------------
await journey('status change', async (page) => {
  // Unfiltered: changing a status under an active status filter drops the row
  // out of the view, so following it by position would follow a different
  // watch. The journey also has to survive being run twice, so it reads the
  // current status rather than assuming one.
  await go(page, '/inventory')
  const stockNo = (await page.locator('tbody tr').first().locator('td').nth(1).innerText()).trim()

  const statusOf = async () => {
    const label = await statusButton(page, stockNo).getAttribute('aria-label')
    return label.replace('Status: ', '').replace('. Change it.', '')
  }
  const pick = async (option) => {
    await statusButton(page, stockNo).click()
    await page.waitForTimeout(300)
    const item = page.locator(`[role="menu"] button:text-is("${option}")`)
    if (await item.count() === 0) {
      const offered = await page.locator('[role="menu"] button').allInnerTexts()
      throw new Error(`"${option}" was not offered; menu had: ${offered.join(', ')}`)
    }
    await item.click()
    await page.waitForTimeout(2500)
  }

  const start = await statusOf()
  const target = start === 'Reserved' ? 'Sale agreed' : 'Reserved'

  await pick(target)
  if (await statusOf() !== target) throw new Error(`stock ${stockNo} did not become ${target}, it is ${await statusOf()}`)

  // Back to where it started, which also exercises the reverse transition.
  await pick(start)
  if (await statusOf() !== start) throw new Error(`did not revert to ${start}, it is ${await statusOf()}`)
})

// --- 2. The menu gets out of the way when the page scrolls -----------------
await journey('menu on scroll', async (page) => {
  await go(page, '/inventory')
  await page.locator('button[aria-label^="Status:"]').first().click()
  await page.waitForTimeout(300)
  if (await page.locator('[role="menu"]').count() === 0) throw new Error('the menu did not open')

  await page.mouse.wheel(0, 400)
  await page.waitForTimeout(500)

  if (await page.locator('[role="menu"]').count() > 0) {
    throw new Error('the menu is still on screen after scrolling — it will be pointing at the wrong row')
  }
})

// --- 2b. It opens upwards when there is no room below ----------------------
await journey('menu flips near the bottom', async (page) => {
  await go(page, '/inventory')
  const triggers = page.locator('button[aria-label^="Status:"]')
  const last = triggers.nth(await triggers.count() - 1)
  await last.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await last.click()
  await page.waitForTimeout(400)

  const menu = await page.locator('[role="menu"]').boundingBox()
  if (!menu) throw new Error('the menu did not open')
  const viewport = page.viewportSize()
  if (menu.y + menu.height > viewport.height + 2) {
    throw new Error(`menu runs off the bottom: ends at ${(menu.y + menu.height).toFixed(0)} of ${viewport.height}`)
  }
})

// --- 3. Mark as sold, from the status menu ---------------------------------
await journey('mark as sold', async (page) => {
  await go(page, '/inventory?status=IN_STOCK')
  const trigger = page.locator('button[aria-label^="Status:"]').first()
  await trigger.click()
  await page.waitForTimeout(300)
  await page.locator('[role="menu"] button:has-text("Mark as sold")').click()
  await page.waitForTimeout(800)

  const dialog = page.locator('[role="dialog"]:has-text("Mark as sold")')
  if (await dialog.count() === 0) throw new Error('the sell dialog did not open')

  const invoice = `INV-J-${Date.now().toString().slice(-7)}`
  await page.locator('[role="dialog"] input[inputmode="decimal"]').first().fill('12500')
  await page.fill('input[placeholder="INV-2026-001"]', invoice)
  await page.fill('input[placeholder="Who took the watch"]', 'Journey Test Buyer')
  await page.locator('[role="dialog"] button:has-text("Record sale")').click()
  await page.waitForTimeout(3000)

  // Surface whatever the form said rather than only reporting the absence.
  if (await page.locator('[role="dialog"]').count() > 0) {
    const shown = await page.locator('[role="dialog"]').innerText()
    const complaint = shown.split('\n').find((line) => /must|required|could not|already/i.test(line))
    throw new Error(`the dialog stayed open${complaint ? `: ${complaint}` : ''}`)
  }

  await go(page, '/sales')
  const row = page.locator(`tr:has-text("${invoice}")`)
  if (await row.count() === 0) throw new Error(`sale ${invoice} is not in the ledger`)
  if (!(await row.innerText()).includes('Journey Test Buyer')) throw new Error('the buyer was not saved')
})

// --- 4. Void that sale, from the status menu -------------------------------
await journey('void a sale', async (page) => {
  await go(page, '/inventory?status=SOLD')
  const trigger = page.locator('button[aria-label^="Status:"]').filter({ hasText: 'Sold' }).first()
  if (await trigger.count() === 0) throw new Error('no sold watch to void')

  const stockNo = await page.locator('tbody tr').first().locator('td').nth(1).innerText()
  await trigger.click()
  await page.waitForTimeout(300)
  await page.locator('[role="menu"] button:has-text("Void the sale")').click()
  await page.waitForTimeout(800)

  const dialog = page.locator('[role="dialog"]:has-text("Void this sale")')
  if (await dialog.count() === 0) throw new Error('the void dialog did not open')

  await page.fill('textarea', 'Journey test reversal')
  await page.click('button:has-text("Void the sale")')
  await page.waitForTimeout(3000)

  await go(page, '/inventory')
  const row = page.locator(`tr:has(td:text-is("${stockNo.trim()}"))`)
  const text = await row.first().innerText()
  if (!text.includes('In stock')) throw new Error(`stock ${stockNo.trim()} did not return to stock: ${text.replace(/\n/g, ' | ')}`)
})

// --- 5. Inline price edit ---------------------------------------------------
await journey('inline price edit', async (page) => {
  await go(page, '/inventory')
  const cell = page.locator('button[aria-label*="sale price" i]').first()
  if (await cell.count() === 0) throw new Error('no editable price cell found')
  await cell.click()
  await page.waitForTimeout(400)
  const input = page.locator('input[inputmode="decimal"]').first()
  if (await input.count() === 0) throw new Error('price cell did not become editable')
  await input.fill('12345')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2500)
  if (!(await page.locator('body').innerText()).includes('12,345')) {
    throw new Error('the new price is not on screen after saving')
  }
})

// --- 6. Bulk delete offers an undo that works ------------------------------
await journey('delete then undo', async (page) => {
  await go(page, '/inventory')
  const checkbox = page.locator('tbody input[type="checkbox"]').first()
  if (await checkbox.count() === 0) throw new Error('no selectable row')
  const stockNo = (await page.locator('tbody tr').first().locator('td').nth(1).innerText()).trim()
  await checkbox.check()
  await page.waitForTimeout(400)

  await page.click('button:has-text("Delete")')
  await page.waitForTimeout(500)
  await page.locator('[role="dialog"] button:has-text("Delete")').last().click()
  await page.waitForTimeout(2500)

  const undo = page.locator('button:has-text("Undo")')
  if (await undo.count() === 0) throw new Error('no undo was offered')
  await undo.click()
  await page.waitForTimeout(3000)

  await go(page, '/inventory')
  if (await page.locator(`tr:has(td:text-is("${stockNo}"))`).count() === 0) {
    throw new Error(`stock ${stockNo} did not come back after undo`)
  }
})

// --- 7. Supplier create and edit -------------------------------------------
await journey('supplier create', async (page) => {
  await go(page, '/suppliers')
  await page.locator('button:has-text("Add supplier")').first().click()
  await page.waitForTimeout(600)
  const name = `Journey Supplier ${Date.now().toString().slice(-6)}`
  await page.fill('input[name="name"]', name)
  await page.fill('input[name="legalName"]', 'Journey Trading Ltd')
  await page.selectOption('select[name="entityType"]', 'LIMITED_COMPANY')
  await page.fill('input[name="contactName"]', 'Jo Journey')
  await page.selectOption('select[name="paymentTerms"]', 'NET_30')
  await page.locator('[role="dialog"] button[type="submit"]').click()
  await page.waitForTimeout(3000)

  await go(page, '/suppliers')
  const row = page.locator(`tr:has-text("${name}")`)
  if (await row.count() === 0) throw new Error('the supplier was not created')
  const text = await row.first().innerText()
  if (!text.includes('30 days')) throw new Error(`payment terms were not saved: ${text.replace(/\n/g, ' | ')}`)
  if (!text.includes('Jo Journey')) throw new Error('the representative was not saved')
})

// --- 8. Column picker actually hides a column ------------------------------
await journey('column picker', async (page) => {
  await go(page, '/inventory')
  await page.click('button:has-text("Columns")')
  await page.waitForTimeout(400)
  const before = await page.locator('thead th').count()
  await page.locator('label:has-text("Location")').first().click()
  await page.waitForTimeout(600)
  const after = await page.locator('thead th').count()
  if (after >= before) throw new Error(`column count did not fall (${before} -> ${after})`)
})

// --- 9. Saved views filter the list ----------------------------------------
await journey('saved views', async (page) => {
  await go(page, '/inventory')
  const total = await page.locator('tbody tr').count()
  await page.click('button:has-text("Needs a price")')
  await page.waitForTimeout(2000)
  const filtered = await page.locator('tbody tr').count()
  if (filtered >= total) throw new Error(`view did not filter (${total} -> ${filtered})`)
})

// --- 10. Mobile navigation sheet -------------------------------------------
if (!only || 'mobile nav'.includes(only)) {
  const { ctx, page } = await newPage(390, 844)
  try {
    await go(page, '/inventory')
    await page.click('button[aria-haspopup="dialog"]')
    await page.waitForTimeout(500)
    await page.locator('[role="dialog"] a:has-text("Sales")').click()
    await page.waitForTimeout(2500)
    if (!page.url().includes('/sales')) throw new Error(`did not navigate, still at ${page.url()}`)
    results.push('PASS  mobile nav')
  } catch (error) {
    results.push(`FAIL  mobile nav\n      ${error.message.split('\n')[0]}`)
  } finally {
    await page.close()
    await ctx.close()
  }
}

await signedIn.close()
await browser.close()
console.log(results.join('\n'))
const failed = results.some((r) => r.startsWith('FAIL'))
console.log(failed ? '\nSOME JOURNEYS FAILED — screenshots in /tmp' : '\nall journeys passed')
process.exit(failed ? 1 : 0)
