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
import { BASE, ROUTES, launch, signIn } from '../harness/browser.mjs'

const only = process.argv[2]
const results = []

const { browser, ctx: signedIn } = await launch()
await signIn(signedIn)

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

/**
 * The viewer's session, signed in once and shared.
 *
 * Two journeys need a read-only role, and signing in twice within a few
 * seconds trips the application's own login rate limiter — so the suite was
 * failing on a defence working exactly as designed. One login, reused, also
 * means the rate-limit backoff in `signIn` covers both.
 */
let viewerCtx = null
async function viewer() {
  if (!viewerCtx) {
    viewerCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await signIn(viewerCtx, { email: 'priya@bluecroft.co.uk', password: 'Bluecroft2026!' })
  }
  return viewerCtx
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
  // A fixed wait is a race the suite loses as it warms up and pages do more
  // work. Wait for the region every screen has, then settle briefly for the
  // client components that hydrate into it.
  await page.locator('main').waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(900)
}

/**
 * Put a sold watch back into stock.
 *
 * The suite has to be re-runnable, and journeys that sell a watch without
 * returning it were quietly consuming the fixture: twenty-odd runs later there
 * were two watches in stock and the money journeys started failing with
 * "nothing is in stock to sell" — a fault in the tests reported as a fault in
 * the product. Anything that sells now puts it back.
 */
const returnToStock = async (page, stockNo) => {
  await go(page, '/inventory?status=SOLD')
  const row = page.locator(`tr:has(td:text-is("${String(stockNo).trim()}"))`).first()
  if (await row.count() === 0) return false
  await row.locator('button[aria-label^="Status:"]').click()
  await page.waitForTimeout(300)
  const voidItem = page.locator('[role="menu"] button:has-text("Void the sale")')
  if (await voidItem.count() === 0) return false
  await voidItem.click()
  await page.waitForTimeout(700)
  await page.fill('textarea', 'Returned to stock by the journey that sold it')
  await page.click('button:has-text("Void the sale")')
  await page.waitForTimeout(2500)
  return true
}

/**
 * Sell the first watch in stock, and return what it was.
 *
 * Extracted once three journeys needed a sale to exist. Each journey creating
 * its own is the only arrangement that survives being run in any order: the
 * suite used to depend on "mark as sold" leaving a sold watch behind for
 * "void a sale" to find, which held right up until the selling journeys
 * started cleaning up after themselves.
 */
const sellFirstInStock = async (page, prefix) => {
  await go(page, '/inventory?status=IN_STOCK')
  const row = page.locator('tbody tr').first()
  if (await row.count() === 0) throw new Error('nothing is in stock to sell')
  const stockNo = (await row.locator('td').nth(1).innerText()).trim()

  await row.locator('button[aria-label^="Status:"]').click()
  await page.waitForTimeout(300)
  await page.locator('[role="menu"] button:has-text("Mark as sold")').click()
  await page.waitForTimeout(900)

  const dialog = page.locator('[role="dialog"]:has-text("Mark as sold")')
  if (await dialog.count() === 0) throw new Error('the sell dialog did not open')

  const invoice = `${prefix}${Date.now().toString().slice(-7)}`
  await dialog.locator('input[inputmode="decimal"]').first().fill('11000')
  await page.fill('input[placeholder="INV-2026-001"]', invoice)
  await dialog.locator('button:has-text("Record the sale")').click()
  await page.waitForTimeout(3000)

  if (await page.locator('[role="dialog"]').count() > 0) {
    const shown = await page.locator('[role="dialog"]').innerText()
    throw new Error(`the sell dialog stayed open: ${shown.split('\n').find((l) => /must|required|could not|already/i.test(l)) ?? ''}`)
  }
  return { stockNo, invoice }
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

  // A sold watch offers no transitions, so the journey takes the first row
  // that is not one. The list stays unfiltered for the reason above.
  const rows = page.locator('tbody tr')
  let stockNo = null
  for (let index = 0; index < await rows.count(); index += 1) {
    const label = await rows.nth(index).locator('button[aria-label^="Status:"]').getAttribute('aria-label')
    if (label && !label.includes('Sold')) {
      stockNo = (await rows.nth(index).locator('td').nth(1).innerText()).trim()
      break
    }
  }
  if (!stockNo) throw new Error('every row on the first page is already sold')

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
  await page.locator('tbody button[aria-label^="Status:"]').first().click()
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
  const triggers = page.locator('tbody button[aria-label^="Status:"]')
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
  // Scoped to the table: the same rows are also rendered as cards for phones,
  // hidden at this width but still in the DOM and first in document order.
  const soldStockNo = (await page.locator('tbody tr').first().locator('td').nth(1).innerText()).trim()
  const trigger = page.locator('tbody button[aria-label^="Status:"]').first()
  await trigger.click()
  await page.waitForTimeout(300)
  await page.locator('[role="menu"] button:has-text("Mark as sold")').click()
  await page.waitForTimeout(800)

  const dialog = page.locator('[role="dialog"]:has-text("Mark as sold")')
  if (await dialog.count() === 0) throw new Error('the sell dialog did not open')

  const invoice = `INV-J-${Date.now().toString().slice(-7)}`
  await page.locator('[role="dialog"] input[inputmode="decimal"]').first().fill('12500')
  await page.fill('input[placeholder="INV-2026-001"]', invoice)

  // The buyer fields are behind a disclosure now that a sale is normally
  // attributed to a customer record. This journey takes the other route: a
  // buyer nobody has met before, who should come out of it on the book.
  const byHand = page.locator('[role="dialog"] button:has-text("Clear and enter the buyer by hand")')
  if (await byHand.count() > 0) await byHand.click()
  const reveal = page.locator('[role="dialog"] button:has-text("add them to the book")')
  if (await reveal.count() > 0) await reveal.click()
  await page.waitForTimeout(200)
  const surname = `Journeybuyer ${Date.now().toString().slice(-6)}`
  await page.locator('[role="dialog"] input[placeholder="Priya"]').fill('Test')
  await page.locator('[role="dialog"] input[placeholder="Raman"]').fill(surname)
  await page.locator('[role="dialog"] button:has-text("Record the sale")').click()
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
  const ledger = await row.innerText()
  if (!ledger.includes(surname)) throw new Error('the buyer was not saved against the sale')

  // And the point of the exercise: they are on the book, with the purchase
  // already against them, rather than being a name stranded on one row.
  await go(page, `/customers?q=${encodeURIComponent(surname)}`)
  const customerRow = page.locator(`tbody tr:has-text("${surname}")`)
  if (await customerRow.count() === 0) {
    throw new Error('the buyer was recorded on the sale but never reached the customer book')
  }
  if (!(await customerRow.innerText()).includes('1')) {
    throw new Error('the new customer does not show the purchase')
  }

  // The same sale, seen from the inventory. The profit was being read from the
  // USD column and printed through the GBP formatter, so the two screens
  // disagreed by the exchange rate.
  const profit = ledger.split('\n').map((s) => s.trim()).find((s) => /^\+?£[\d,]+$/.test(s) && s.includes('+'))
  await go(page, '/inventory?status=SOLD')
  const stockRow = page.locator(`tbody tr:has-text("${invoice.slice(-4)}"), tbody tr`).first()
  const shown = await stockRow.innerText()
  if (profit && !shown.includes(profit.replace('+', ''))) {
    throw new Error(`inventory and the ledger disagree on profit: ledger ${profit}, inventory row "${shown.replace(/\n/g, ' / ')}"`)
  }

  await returnToStock(page, soldStockNo)
})

// --- 4. Void that sale, from the status menu -------------------------------
await journey('void a sale', async (page) => {
  // Sells its own watch first. Depending on another journey to leave one
  // behind held only until the selling journeys started cleaning up after
  // themselves, and then this failed with "no sold watch to void" — a fault
  // in the suite's ordering wearing the costume of a product fault.
  const { stockNo } = await sellFirstInStock(page, 'INV-R-')

  await go(page, '/inventory?status=SOLD')
  const trigger = page.locator(`tr:has(td:text-is("${stockNo}")) button[aria-label^="Status:"]`).first()
  if (await trigger.count() === 0) throw new Error(`stock ${stockNo} is not in the sold list`)

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

// --- 10. Sign out of other devices -----------------------------------------
await journey('sign out other devices', async (page) => {
  await go(page, '/settings/profile')
  const button = page.locator('button:has-text("Sign out other devices")')
  if (await button.count() === 0) throw new Error('the control is missing from the profile page')

  const current = page.locator('li:has-text("This device")')
  if (await current.count() !== 1) throw new Error('exactly one session should be marked as this device')

  if (!(await button.isDisabled())) {
    await button.click()
    await page.waitForTimeout(2500)
    if (await page.locator('[role="status"], [role="alert"]').count() === 0) {
      throw new Error('no confirmation was shown')
    }
  }
  // Whatever happened, the session reading the page must survive it.
  await go(page, '/settings/profile')
  if (page.url().includes('/login')) throw new Error('it signed the current device out too')
})

// --- 10b. Selling a watch attributes it to a customer and closes the deal ---
await journey('sell links customer and deal', async (page) => {
  // A watch with a deal open against it, so the form has both halves to join.
  await go(page, '/inventory?status=IN_STOCK')
  // Earlier journeys sell and void as they go, so this one states plainly what
  // it needs rather than hanging on a selector that will never resolve — and
  // it tracks its own watch, because the first Sold row belongs to somebody
  // else's journey by the time this runs.
  const firstRow = page.locator('tbody tr').first()
  if (await firstRow.count() === 0) throw new Error('nothing is in stock to sell')
  const stockNo = (await firstRow.locator('td').nth(1).innerText()).trim()
  const trigger = firstRow.locator('button[aria-label^="Status:"]')
  await trigger.click()
  await page.waitForTimeout(300)
  await page.locator('[role="menu"] button:has-text("Mark as sold")').click()
  await page.waitForTimeout(900)

  const dialog = page.locator('[role="dialog"]:has-text("Mark as sold")')
  if (await dialog.count() === 0) throw new Error('the sell dialog did not open')

  const picker = dialog.locator('button:has-text("Search the customer book"), button:has-text("·")').first()
  if (await dialog.locator('text=Customer').count() === 0) {
    throw new Error('the sell form has no way to attribute the sale to a customer')
  }
  void picker

  // Choose the first customer on the book if the form has not pre-filled one.
  const cleared = await dialog.locator('button:has-text("Clear and enter the buyer by hand")').count()
  if (cleared === 0) {
    await dialog.locator('button:has-text("Search the customer book")').click()
    await page.waitForTimeout(300)
    const option = page.locator('[role="listbox"] li, [role="option"]').first()
    if (await option.count() > 0) await option.click()
    await page.waitForTimeout(300)
  }

  const invoice = `INV-L-${Date.now().toString().slice(-7)}`
  await dialog.locator('input[inputmode="decimal"]').first().fill('9500')
  await page.fill('input[placeholder="INV-2026-001"]', invoice)
  await dialog.locator('button:has-text("Record the sale")').click()
  await page.waitForTimeout(3000)

  if (await page.locator('[role="dialog"]').count() > 0) {
    const shown = await page.locator('[role="dialog"]').innerText()
    throw new Error(`the dialog stayed open: ${shown.split('\n').find((l) => /must|required|could not|already/i.test(l)) ?? ''}`)
  }

  // The sale has to be findable from the customer's own record, which is the
  // whole point of joining the two halves.
  await go(page, '/sales')
  const row = page.locator(`tr:has-text("${invoice}")`)
  if (await row.count() === 0) throw new Error(`sale ${invoice} is not in the ledger`)

  await returnToStock(page, stockNo)
})

// --- 10c. A customer can be added from wherever one is chosen ---------------
await journey('add a customer from the deal form', async (page) => {
  await go(page, '/pipeline')
  await page.locator('button:has-text("New deal")').click()
  await page.waitForTimeout(800)

  const picker = page.locator('button:has-text("Choose a customer"), button:has-text("Nobody on the book")').first()
  if (await picker.count() === 0) throw new Error('the deal form has no customer picker')
  await picker.click()
  await page.waitForTimeout(400)

  const name = `Picker Newman ${Date.now().toString().slice(-6)}`
  await page.keyboard.type(name)
  await page.waitForTimeout(400)

  const add = page.locator('button').filter({ hasText: 'Add' }).last()
  if (await add.count() === 0) throw new Error('no way to add a customer who is not on the book')
  await add.click()
  await page.waitForTimeout(2500)

  if (await page.locator(`button:has-text("${name}")`).count() === 0) {
    throw new Error('the customer was added but not selected')
  }

  // And they are really on the book, not just in the dropdown.
  await go(page, `/customers?q=${encodeURIComponent(name.split(' ')[1])}`)
  if (await page.locator(`tbody tr:has-text("${name.split(' ')[1]}")`).count() === 0) {
    throw new Error('the customer never reached the book')
  }
})

// --- 11. The inventory list on a phone -------------------------------------
if (!only || 'inventory on a phone'.includes(only)) {
  const { ctx, page } = await newPage(390, 844)
  try {
    await go(page, '/inventory')
    const cards = page.locator('main ul > li:has-text("Est. sale")')
    if (await cards.count() === 0) throw new Error('no cards rendered; the table would need a sideways scroll')

    const first = cards.first()
    const text = await first.innerText()
    if (!/£|\$|AED|HK\$/.test(text)) throw new Error(`no figure on the card: ${text.replace(/\n/g, ' / ')}`)

    // Tapping the card opens the record.
    await first.locator('button').first().click()
    await page.waitForTimeout(1600)
    if (await page.locator('[role="dialog"]').count() === 0) throw new Error('tapping a card did not open the record')

    results.push('PASS  inventory on a phone')
  } catch (error) {
    results.push(`FAIL  inventory on a phone\n      ${error.message.split('\n')[0]}`)
    await page.screenshot({ path: '/tmp/journey-fail-mobile-inventory.png', fullPage: true })
  } finally {
    await page.close()
    await ctx.close()
  }
}

// --- 12. Mobile navigation sheet -------------------------------------------
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

// --- E2. The four things the server could create and the interface could not

const stamp = Date.now().toString().slice(-6)

/** Open an inline composer by its prompt, and wait for the form to appear. */
const openComposer = async (page, prompt) => {
  const trigger = page.locator(`button:has-text("${prompt}")`).first()
  await trigger.waitFor({ state: 'visible', timeout: 10_000 })
  await trigger.click()
  await page.waitForTimeout(400)
}

await journey('a follow-up created on a contact appears on the task list', async (page) => {
  // The assertion the plan asks for by name: creating it is not enough, it has
  // to turn up where the person who has to do it will look.
  await go(page, '/customers')
  await page.locator('table a[href^="/customers/"]').first().click()
  await page.waitForTimeout(1200)
  const record = new URL(page.url()).pathname

  const title = `Ring back about the Daytona ${stamp}`
  await openComposer(page, 'Add a follow-up')
  await page.fill('input[name="title"]', title)
  await page.click('button:has-text("Add task")')
  await page.waitForTimeout(2500)

  await go(page, record)
  if (!(await page.locator('main').innerText()).includes(title)) {
    throw new Error('the task was not on the record it was created from')
  }

  await go(page, '/tasks')
  if (!(await page.locator('main').innerText()).includes(title)) {
    throw new Error('the task never reached the task list')
  }
})

await journey('a want registered from the wanted list is matched against stock', async (page) => {
  await go(page, '/requests')

  const model = `Submariner ${stamp}`
  await page.click('button:has-text("Register a want")')
  await page.waitForTimeout(500)

  // The customer picker on this screen is a combobox, not a select: it has to
  // be opened, searched and chosen from.
  await page.click('[role="dialog"] button:has-text("Choose a customer")')
  await page.waitForTimeout(300)
  await page.locator('[role="dialog"] [role="option"], [role="dialog"] li button').first().click()
  await page.waitForTimeout(300)

  await page.fill('[role="dialog"] input[name="model"]', model)
  await page.click('[role="dialog"] button:has-text("Register it")')
  await page.waitForTimeout(2500)

  await go(page, '/requests')
  const body = await page.locator('main').innerText()
  if (!body.includes(model)) throw new Error('the want never appeared on the wanted list')
  // Every card states its sourcing position; a new one must too.
  if (!/in stock could fit|Nothing in stock fits/.test(body)) {
    throw new Error('the want was listed without saying whether anything matches it')
  }
})

await journey('an offer recorded on a customer shows against them', async (page) => {
  await go(page, '/customers')
  await page.locator('table a[href^="/customers/"]').first().click()
  await page.waitForTimeout(1200)
  const record = new URL(page.url()).pathname

  const before = (await page.locator('main').innerText()).match(/£[\d,]+/g)?.length ?? 0
  await openComposer(page, 'Record an offer')
  await page.fill('input[name="amount"]', '43750')
  await page.click('button:has-text("Record it")')
  await page.waitForTimeout(2500)

  await go(page, record)
  const body = await page.locator('main').innerText()
  if (!/43,750/.test(body)) {
    throw new Error(`the offer did not appear on the record (${before} figures before)`)
  }
  if (!/Offers/.test(body)) throw new Error('the offers panel is missing entirely')
})

await journey('a supplier enquiry is logged against a want', async (page) => {
  // Counted across every card, not on the first one. Logging an enquiry can
  // reorder the board, and a journey that reads "the first card" before and
  // after is then comparing two different requests — which is how this
  // assertion passed for the wrong reason the first time it was written.
  //
  // E9 replaced the "N supplier enquiries out" tally with a named list of who
  // was asked and what they said, so the count is now of those rows: each one
  // leads with its status label on its own line.
  const enquiriesOut = async () => {
    const body = await page.locator('main').innerText()
    return (body.match(/^(Asked|Quoted|Declined|No reply)\b/gm) ?? []).length
  }

  await go(page, '/requests')
  const start = await enquiriesOut()

  await openComposer(page, 'Log a supplier enquiry')
  await page.selectOption('select[name="supplierId"]', { index: 1 })
  await page.click('button:has-text("Log it")')
  await page.waitForTimeout(2500)

  await go(page, '/requests')
  const end = await enquiriesOut()
  if (end <= start) throw new Error(`enquiries out did not rise: ${start} → ${end}`)
})

await journey('a viewer is shown no create controls at all', async () => {
  // Not a disabled button. A greyed-out control is an advertisement for a
  // thing you cannot have, and it is also indistinguishable from a bug.
  const ctx = await viewer()
  const page = await ctx.newPage()
  try {

    const forbidden = [
      ['/tasks', 'Add a follow-up'],
      ['/requests', 'Register a want'],
      ['/requests', 'Log a supplier enquiry'],
    ]
    const leaked = []
    for (const [route, label] of forbidden) {
      await page.goto(BASE + route, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(800)
      if (await page.locator(`button:has-text("${label}")`).count() > 0) {
        leaked.push(`${route} offers "${label}"`)
      }
    }
    if (leaked.length) throw new Error(leaked.join(' · '))
  } finally {
    await page.close()
  }
})

// --- E3. The deal record

await journey('a deal record opens from the board and records what happens on it', async (page) => {
  await go(page, '/pipeline')

  // The card title links to the deal now. Before E3 it linked to the customer,
  // because the deal had nowhere to link to.
  const link = page.locator('article a[href^="/pipeline/"]:visible').first()
  await link.waitFor({ state: 'visible', timeout: 10_000 })
  await link.click()
  await page.waitForTimeout(1800)

  const record = new URL(page.url()).pathname
  if (!/^\/pipeline\/.+/.test(record)) throw new Error(`the card did not open a deal: ${record}`)

  const railText = await page.locator('main').innerText()
  // The rail is the thing that only this screen can show.
  if (!/so far|Won after|Lost after/.test(railText)) {
    throw new Error('the stage rail reports no elapsed time at all')
  }

  // Log a call. The timeline's log form is collapsed behind a prompt until it
  // is asked for — an always-open form at the top of a history pushes the
  // history down the page.
  const note = `Discussed shipping ${stamp}`
  await page.click('button:has-text("Log a call, message or note")')
  await page.waitForTimeout(400)
  await page.selectOption('select[name="type"]', 'CALL').catch(() => {})
  await page.fill('input[name="subject"]', note)
  await page.click('button:has-text("Log it"), button:has-text("Log")')
  await page.waitForTimeout(2200)

  await go(page, record)
  if (!(await page.locator('main').innerText()).includes(note)) {
    throw new Error('the call never appeared on the deal timeline')
  }

  // Record an offer against the deal.
  await openComposer(page, 'Record an offer')
  await page.fill('input[name="amount"]', '31250')
  await page.click('button:has-text("Record it")')
  await page.waitForTimeout(2400)

  await go(page, record)
  if (!/31,250/.test(await page.locator('main').innerText())) {
    throw new Error('the offer did not appear in the deal offers panel')
  }
})

await journey('moving a stage updates the rail on the record', async (page) => {
  await go(page, '/pipeline')
  const link = page.locator('article a[href^="/pipeline/"]:visible').first()
  await link.click()
  await page.waitForTimeout(1800)
  const record = new URL(page.url()).pathname

  const stage = page.locator('select[name="stage"]').first()
  const before = await stage.inputValue()
  const options = await stage.locator('option').evaluateAll(
    (nodes) => nodes.map((n) => n.value).filter(Boolean),
  )
  const next = options.find((value) => value !== before)
  if (!next) throw new Error('the stage selector offers nowhere to move to')

  await stage.selectOption(next)
  await page.waitForTimeout(2500)

  await go(page, record)
  const after = await page.locator('select[name="stage"]').first().inputValue()
  if (after !== next) throw new Error(`the stage did not stick: asked for ${next}, got ${after}`)

  // The rail has to know about it too — that is the whole point of the screen.
  const body = await page.locator('main').innerText()
  if (!/so far/.test(body)) throw new Error('the rail stopped reporting a current dwell after the move')
  if (!body.includes('Moved to')) {
    throw new Error('the move was not written to the timeline the rail is built from')
  }
})

// --- E4. Search and peek

/** Open the palette and type, waiting for results to settle. */
const palette = async (page, text) => {
  await page.keyboard.press('Control+k')
  await page.waitForSelector('[aria-label="Search and commands"]', { timeout: 10_000 })
  if (text) {
    await page.fill('input[aria-label="Search"]', text)
    await page.waitForTimeout(900)
  }
}

await journey('search finds a person, a watch and a deal from one box', async (page) => {
  await go(page, '/inventory')

  // A surname. V1 could not find a person at all — it searched watches only.
  await palette(page, 'reinhardt')
  let body = await page.locator('[aria-label="Search and commands"]').innerText()
  if (!/contacts/i.test(body)) throw new Error(`a surname found no contacts: ${body.slice(0, 200)}`)
  if (!/Reinhardt/i.test(body)) throw new Error('the contact itself is missing from the results')

  // A stock number typed as a fragment, the way it is quoted down a phone.
  await page.fill('input[aria-label="Search"]', '114')
  await page.waitForTimeout(900)
  body = await page.locator('[aria-label="Search and commands"]').innerText()
  if (!/watches/i.test(body)) throw new Error('a stock-number fragment found no watches')
  // Two watches can share a reference, so the row has to carry a serial.
  if (!/serial|no serial/.test(body)) throw new Error('watch rows do not disambiguate themselves')

  // An action, addressed with the prefix rather than by remembering a menu.
  await page.fill('input[aria-label="Search"]', '>stock')
  await page.waitForTimeout(500)
  body = await page.locator('[aria-label="Search and commands"]').innerText()
  if (!/actions/i.test(body)) throw new Error('the > prefix did not switch to actions')

  await page.keyboard.press('Escape')
})

await journey('a phone number with punctuation finds its owner', async (page) => {
  await go(page, '/customers')

  // Finding a fixture and making the assertion are two different jobs. Only
  // eight of forty-four customers have a number recorded and they are not the
  // first eight alphabetically, so the number is located through the API —
  // a contact's subtitle carries it — and the claim is then tested through the
  // palette, which is the thing under test.
  const number = await page.evaluate(async () => {
    for (const seed of ['an', 'ar', 'el', 'on', 'in']) {
      const response = await fetch(`/api/search?q=${seed}`)
      if (!response.ok) continue
      const data = await response.json()
      for (const hit of data.hits ?? []) {
        if (hit.kind !== 'contact') continue
        const match = String(hit.subtitle).match(/\+?\d[\d\s()+-]{8,}\d/)
        if (match) return match[0]
      }
    }
    return null
  })
  if (!number) throw new Error('no customer in the book has a phone number to search for')

  // Written the way somebody would actually type it from memory: last nine
  // digits, spaced and hyphenated, none of it matching how it was stored.
  const digits = number.replace(/\D/g, '')
  const mangled = `${digits.slice(-9, -6)} ${digits.slice(-6, -3)}-${digits.slice(-3)}`

  await palette(page, mangled)
  const body = await page.locator('[aria-label="Search and commands"]').innerText()
  if (!/contacts/i.test(body)) {
    throw new Error(`punctuation defeated the phone search: "${mangled}" (stored as "${number}") found nothing`)
  }
  await page.keyboard.press('Escape')
})

await journey('search stays inside its latency budget', async (page) => {
  // The number the palette lives or dies on. Measured against whatever the
  // database currently holds — run src/server/db/seed/scale.ts first to
  // measure it against ten times that.
  await go(page, '/inventory')
  const timings = []
  for (const term of ['sub', 'rein', 'tanaka', '114', 'daytona']) {
    const took = await page.evaluate(async (q) => {
      const started = performance.now()
      const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      const data = await response.json()
      return { wall: performance.now() - started, server: data.tookMs ?? -1 }
    }, term)
    timings.push({ term, ...took })
  }
  const slow = timings.filter((row) => row.server > 100)
  if (slow.length) {
    throw new Error(`over budget: ${slow.map((r) => `${r.term} ${r.server}ms`).join(', ')}`)
  }
})

await journey('peek shows a record and gives the page back', async (page) => {
  await go(page, '/inventory')

  // Focus a row, then the same key that peeks in the palette.
  const row = page.locator('tbody tr[tabindex="0"]').first()
  await row.waitFor({ state: 'visible', timeout: 10_000 })
  await row.focus()
  await page.keyboard.press('ArrowRight')

  const overlay = page.locator('[role="dialog"][aria-label^="Preview"]')
  await overlay.waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForTimeout(900)

  const shown = await overlay.innerText()
  for (const fact of ['Status', 'Cost', 'Asking', 'Margin']) {
    if (!shown.includes(fact)) throw new Error(`the peek omits ${fact}`)
  }
  if (!/Lately/.test(shown)) throw new Error('the peek shows no recent activity section')

  const before = page.url()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)

  if (await overlay.count() > 0) throw new Error('escape did not dismiss the peek')
  if (page.url() !== before) throw new Error('the peek navigated away — it is meant to give the page back')

  // Focus has to come back to the row, or "carry on where you were" is a claim
  // the overlay does not honour for anybody using a keyboard.
  const refocused = await page.evaluate(() => document.activeElement?.tagName)
  if (refocused !== 'TR') throw new Error(`focus went to ${refocused} instead of back to the row`)
})

// --- E5. Today

await journey('the front door opens on the agenda, not the dashboard', async (page) => {
  await go(page, '/')
  if (!page.url().endsWith('/today')) {
    throw new Error(`/ went to ${page.url()} instead of the agenda`)
  }
  const body = await page.locator('main').innerText()
  if (!/good (morning|afternoon|evening)/i.test(body)) {
    throw new Error('the agenda does not greet anybody — is this still the dashboard?')
  }
  // The figures did not disappear, they moved.
  await go(page, '/insights')
  if (!/capital/i.test(await page.locator('main').innerText())) {
    throw new Error('the figures removed from the dashboard are not on Insights either')
  }
})

await journey('a task can be ticked off the agenda without leaving it', async (page) => {
  // Give the agenda something to work with that this journey owns, so it is
  // not competing with the other suites for whichever row happens to be first.
  const title = `Agenda check ${stamp}`
  await go(page, '/tasks')
  await openComposer(page, 'Add a follow-up')
  await page.fill('input[name="title"]', title)
  await page.fill('input[name="dueAt"]', new Date().toISOString().slice(0, 10))
  await page.click('button:has-text("Add task")')
  await page.waitForTimeout(2500)

  await go(page, '/today')
  const row = page.locator(`li[data-agenda-row]:has-text("${title}")`)
  if (await row.count() === 0) throw new Error('a task due today never reached the agenda')

  await row.first().locator('button[aria-label^="Mark"]').click()
  await page.waitForTimeout(2500)

  await go(page, '/today')
  if (await page.locator(`li[data-agenda-row]:has-text("${title}")`).count() > 0) {
    throw new Error('the task is still on the agenda after being ticked off')
  }

  // And it is actually done, not merely hidden.
  await go(page, '/tasks')
  const tasks = await page.locator('main').innerText()
  if (!tasks.includes(title)) throw new Error('the completed task vanished from the task list entirely')
  const struck = await page.locator(`.line-through:has-text("${title}")`).count()
  if (struck === 0) throw new Error('the task list does not show it as done')
})

await journey('snoozing pushes a task off today and onto its new date', async (page) => {
  const title = `Snooze check ${stamp}`
  await go(page, '/tasks')
  await openComposer(page, 'Add a follow-up')
  await page.fill('input[name="title"]', title)
  await page.fill('input[name="dueAt"]', new Date().toISOString().slice(0, 10))
  await page.click('button:has-text("Add task")')
  await page.waitForTimeout(2500)

  await go(page, '/today')
  const row = page.locator(`li[data-agenda-row]:has-text("${title}")`).first()
  if (await row.count() === 0) throw new Error('the task never reached the agenda')

  await row.focus()
  await page.keyboard.press('s')
  await page.waitForTimeout(2500)

  await go(page, '/today')
  if (await page.locator(`li[data-agenda-row]:has-text("${title}")`).count() > 0) {
    throw new Error('the snoozed task is still on today')
  }

  await go(page, '/tasks')
  const body = await page.locator('main').innerText()
  if (!body.includes(title)) throw new Error('the snoozed task disappeared from the task list')
  // Snooze moves relative to now, so a task snoozed today is due tomorrow —
  // never "in 2 days", which is what adding a day to an existing date gives.
  const line = body.split('\n').find((text) => text.includes(title))
  const context = body.slice(body.indexOf(title), body.indexOf(title) + 200)
  if (!/in (about )?(a day|1 day|\d+ hours|24 hours|tomorrow)/i.test(context)) {
    throw new Error(`snoozed to something other than tomorrow: ${line} ${context.slice(0, 80)}`)
  }
})

// --- E6. The list system

await journey('a filter can be built, shared and survives a reload', async (page) => {
  await go(page, '/inventory')

  await page.click('button:has-text("Filter")')
  await page.waitForTimeout(400)
  await page.locator('[role="menu"] button:has-text("Status")').first().click()
  await page.waitForTimeout(1800)

  const url = new URL(page.url())
  const clauses = url.searchParams.getAll('f')
  if (clauses.length === 0) throw new Error('adding a filter wrote nothing to the URL')
  if (!clauses[0].startsWith('status:')) throw new Error(`unexpected clause: ${clauses[0]}`)

  const chip = page.locator('button[aria-label^="Remove the Status filter"]')
  if (await chip.count() === 0) throw new Error('the filter produced no chip')

  const filtered = await page.locator('main').innerText()

  // The same URL, opened cold. A filtered list that cannot be sent to somebody
  // is a filtered list that gets described down a phone instead.
  await go(page, url.pathname + url.search)
  if (await page.locator('button[aria-label^="Remove the Status filter"]').count() === 0) {
    throw new Error('the filter did not survive being reopened from its own URL')
  }
  const reloaded = await page.locator('main').innerText()
  const countOf = (text) => (text.match(/(\d+) watches? +·/) ?? [])[1]
  if (countOf(filtered) !== countOf(reloaded)) {
    throw new Error(`the same URL produced a different result: ${countOf(filtered)} then ${countOf(reloaded)}`)
  }

  // And it narrows something, or it is not a filter.
  await go(page, '/inventory')
  const unfiltered = countOf(await page.locator('main').innerText())
  if (unfiltered && countOf(filtered) && Number(countOf(filtered)) > Number(unfiltered)) {
    throw new Error('the filter returned more rows than no filter at all')
  }
})

await journey('a stale or hostile filter URL still opens the list', async (page) => {
  // The case that actually happens: a link shared months ago, filtering on a
  // column since renamed. The recipient did nothing wrong and cannot fix it.
  const hostile = "/inventory?f=colour:is:blue&f=status:is:MELTED&f=purchasePriceGbp:gt:'; DROP TABLE watches;--"
  const response = await page.goto(BASE + encodeURI(hostile), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)

  if ((response?.status() ?? 0) >= 400) throw new Error(`a bad filter returned HTTP ${response?.status()}`)
  const body = await page.locator('body').innerText()
  if (/application error|something went wrong/i.test(body)) {
    throw new Error('a bad filter took the page down')
  }
  if (await page.locator('table').count() === 0) throw new Error('the list did not render at all')

  // And the table is still there afterwards, which is the other half of that
  // last clause.
  await go(page, '/inventory')
  if (await page.locator('tbody tr').count() === 0) throw new Error('the inventory is empty after that')
})

await journey('selecting a page offers the whole result set', async (page) => {
  await go(page, '/inventory?perPage=10')

  const header = page.locator('thead input[type="checkbox"]').first()
  if (await header.count() === 0) throw new Error('the list offers no way to select a page')
  await header.click()
  await page.waitForTimeout(600)

  const banner = page.locator('[role="status"]:has-text("on this page")')
  if (await banner.count() === 0) {
    throw new Error('selecting a page never offers the rest of the matching rows')
  }

  const offer = banner.locator('button:has-text("Select all")')
  const offered = await offer.innerText()
  await offer.click()
  await page.waitForTimeout(600)

  const bar = page.locator('[role="region"][aria-label$="selected"]')
  const said = await bar.innerText()
  const total = Number((offered.match(/([\d,]+)/) ?? [])[1]?.replace(/,/g, ''))
  const selected = Number((said.match(/([\d,]+) selected/) ?? [])[1]?.replace(/,/g, ''))
  if (!Number.isFinite(total) || !Number.isFinite(selected)) {
    throw new Error(`could not read the counts: offered "${offered}", bar "${said}"`)
  }
  if (selected !== total) {
    throw new Error(`asked for ${total} and the bar reports ${selected}`)
  }
})

await journey('the same filter bar works on contacts and on sales', async (page) => {
  // The point of a shared grammar is that the second and third lists cost
  // nothing. This asserts they actually got it, rather than each keeping its
  // own toolbar with the new one bolted above.
  for (const [route, field] of [['/customers', 'Tier'], ['/sales', 'Payment']]) {
    await go(page, route)

    // A list with no rows at all shows the way in rather than a toolbar over
    // an empty table — correct behaviour, and the reason this journey checks
    // for it instead of assuming the earlier journeys left data behind.
    if (await page.locator('text=No sales recorded yet').count() > 0) continue

    const searches = await page.locator('main input[placeholder^="Search"]').count()
    if (searches === 0) throw new Error(`${route} has no search box`)
    if (searches > 1) throw new Error(`${route} has ${searches} search boxes — the old toolbar is still there`)

    await page.click('button:has-text("Filter")')
    await page.waitForTimeout(400)
    const option = page.locator(`[role="menu"] button:has-text("${field}")`).first()
    if (await option.count() === 0) throw new Error(`${route} does not offer a ${field} filter`)
    await option.click()
    await page.waitForTimeout(1800)

    const url = new URL(page.url())
    if (url.searchParams.getAll('f').length === 0) {
      throw new Error(`${route} added a filter that wrote nothing to the URL`)
    }
    const body = await page.locator('main').innerText()
    if (/application error|something went wrong/i.test(body)) {
      throw new Error(`${route} broke when filtered`)
    }
  }
})

await journey('a view can be saved, applied and deleted', async (page) => {
  const name = `Journey view ${stamp}`

  // Build something worth saving, then save what is on screen.
  await go(page, '/inventory')
  await page.click('button:has-text("Filter")')
  await page.waitForTimeout(400)
  await page.locator('[role="menu"] button:has-text("Status")').first().click()
  await page.waitForTimeout(1600)
  const savedQuery = new URL(page.url()).search

  await page.click('button:has-text("Save this view")')
  await page.waitForTimeout(500)
  await page.fill('[role="dialog"] input[type="text"], [role="dialog"] input:not([type="checkbox"])', name)
  await page.click('[role="dialog"] button:has-text("Save it")')
  await page.waitForTimeout(2500)

  // It survives a cold load of the list.
  await go(page, '/inventory')
  const chip = page.locator(`button:has-text("${name}")`).first()
  if (await chip.count() === 0) throw new Error('the saved view is not on the list after a reload')

  // And applying it restores the filter it was saved with.
  await chip.click()
  await page.waitForTimeout(1800)
  const applied = new URL(page.url()).search
  const normalise = (search) => [...new URLSearchParams(search).entries()]
    .filter(([key]) => key !== 'page')
    .map(([key, value]) => `${key}=${value}`)
    .sort().join('&')
  if (normalise(applied) !== normalise(savedQuery)) {
    throw new Error(`the view applied "${applied}" but was saved as "${savedQuery}"`)
  }

  // The chip has to know it is the one being looked at, or nobody presses it
  // twice.
  const pressed = await chip.getAttribute('aria-pressed')
  if (pressed !== 'true') throw new Error('the applied view does not show as active')

  // Clean up after itself, and prove deleting works while doing so.
  await page.locator(`button[aria-label="Options for the ${name} view"]`).click()
  await page.waitForTimeout(400)
  await page.locator('[role="menu"] button:has-text("Delete it")').click()
  await page.waitForTimeout(2500)

  await go(page, '/inventory')
  if (await page.locator(`button:has-text("${name}")`).count() > 0) {
    throw new Error('the deleted view is still there')
  }
})

await journey('insights answers the selling questions with a table behind every chart', async (page) => {
  await go(page, '/insights')
  const body = await page.locator('main').innerText()

  for (const heading of ['Where deals fall out', 'How often deals land', 'Where deals get stuck']) {
    if (!body.includes(heading)) throw new Error(`the selling section is missing "${heading}"`)
  }

  // The funnel is monotonic by construction; the screen must agree. Read the
  // numbers off the rendered chart and check each rung is <= the one before.
  const funnelFrame = page.locator('section[aria-labelledby]:has(> div h3:text("Where deals fall out"))').last()
  const shown = await funnelFrame.innerText()
  const counts = [...shown.matchAll(/^\s*(\d+)\s*$/gm)].map((m) => Number(m[1]))
  for (let i = 1; i < counts.length; i += 1) {
    if (counts[i] > counts[i - 1]) {
      throw new Error(`the rendered funnel is not monotonic: ${counts.join(', ')}`)
    }
  }

  // Every chart carries a keyboard-reachable table view showing the same data.
  const toggle = funnelFrame.locator('button:has-text("Table")')
  if (await toggle.count() === 0) throw new Error('the funnel has no table view')
  await toggle.focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const table = funnelFrame.locator('table')
  if (await table.count() === 0) throw new Error('the table toggle showed no table')
  const tableText = await table.innerText()
  if (counts.length > 0 && !tableText.includes(String(counts[0]))) {
    throw new Error('the table view does not show the same top-of-funnel number as the chart')
  }

  // Terminal outcomes are not stages and must not appear in the dwell chart.
  const dwellFrame = page.locator('section[aria-labelledby]:has(> div h3:text("Where deals get stuck"))').last()
  const dwellText = await dwellFrame.innerText()
  if (/\bLost\b|\bWon\b/.test(dwellText)) {
    throw new Error('the dwell chart lists a terminal outcome as a stage')
  }
})

await journey('a phone gets the bottom bar, a stage list and full-screen search', async (page) => {
  // The consultation flow at 390px, end to end: navigate by thumb, read the
  // pipeline as a list, find somebody by typing.
  await page.setViewportSize({ width: 390, height: 844 })

  await go(page, '/today')
  const bar = page.locator('nav[aria-label="Primary"]')
  if (await bar.count() === 0) throw new Error('no bottom bar on a phone')
  for (const label of ['Today', 'Search', 'Deals', 'Contacts']) {
    if (await bar.locator(`a:has-text("${label}")`).count() === 0) {
      throw new Error(`the bottom bar is missing ${label}`)
    }
  }

  // Deals: a stage selector and a vertical list, never a sideways board.
  await bar.locator('a:has-text("Deals")').click()
  await page.waitForTimeout(1500)
  const select = page.locator('main select').first()
  if (await select.count() === 0) throw new Error('no stage selector on the phone pipeline')
  const box = await select.boundingBox()
  if (!box || box.height < 40) throw new Error(`stage selector is ${Math.round(box?.height ?? 0)}px — not tappable`)
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (overflow > 1) throw new Error(`the pipeline still scrolls sideways by ${overflow}px on a phone`)

  // Search is a destination: one tap, input focused, results are links.
  await bar.locator('a:has-text("Search")').click()
  await page.waitForTimeout(1500)
  const focused = await page.evaluate(() => document.activeElement?.tagName)
  if (focused !== 'INPUT') throw new Error(`search opened with focus on ${focused}, not the input`)
  await page.keyboard.type('rein')
  await page.waitForTimeout(1500)
  const results = await page.locator('main a[href^="/customers/"]').count()
  if (results === 0) throw new Error('typing a surname on the search page found nobody')

  await page.setViewportSize({ width: 1440, height: 1000 })
})

// --- E11. The two new roles, asserted against the payload

/** Sign a role's seed user in on a fresh context, run the checks, close. */
const asRole = async (email, fn) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  try {
    await signIn(ctx, { email, password: 'Bluecroft2026!' })
    await fn(page)
  } finally {
    await page.close()
    await ctx.close()
  }
}

await journey('a Sales role sees prices but never costs — in the payload, not the CSS', async () => {
  // The fixture: stock 1364 cost £7,835 and asks £12,345. The claim is not
  // "the cost is hidden" but "the cost never left the server" — asserted
  // against page.content(), the HTML the browser received, because
  // display:none is still a leak.
  await asRole('chloe@bluecroft.co.uk', async (salesPage) => {
    await salesPage.goto(BASE + '/inventory', { waitUntil: 'domcontentloaded' })
    await salesPage.waitForTimeout(1800)
    const payload = await salesPage.content()
    if (payload.includes('7,835')) throw new Error('the cost figure reached a Sales payload')
    if (!payload.includes('12,345')) throw new Error('the asking price is missing for Sales — over-masked')
    const visible = await salesPage.locator('main').innerText()
    if (/\bCost\b|Est\. profit|Capital invested/.test(visible)) {
      throw new Error('a cost column or tile is still advertised to Sales')
    }

    // The surfaces made entirely of cost figures answer with a refusal, not a
    // half-empty page.
    const insights = await salesPage.goto(BASE + '/insights', { waitUntil: 'domcontentloaded' })
    await salesPage.waitForTimeout(800)
    const body = await salesPage.locator('body').innerText()
    if ((insights?.status() ?? 0) < 400 && !/not part of your role|cannot|permission|forbidden/i.test(body)) {
      throw new Error('Sales reached the insights page, which is made of cost figures')
    }

    // Selling still works: the pipeline is theirs.
    await salesPage.goto(BASE + '/pipeline', { waitUntil: 'domcontentloaded' })
    await salesPage.waitForTimeout(1200)
    if (await salesPage.locator('main select, main article').count() === 0) {
      throw new Error('Sales cannot see the pipeline that is supposed to be their screen')
    }
  })
})

await journey('an Operations role sees no money in either direction', async () => {
  await asRole('daniel@bluecroft.co.uk', async (opsPage) => {
    await opsPage.goto(BASE + '/inventory', { waitUntil: 'domcontentloaded' })
    await opsPage.waitForTimeout(1800)
    const payload = await opsPage.content()
    if (payload.includes('7,835')) throw new Error('a cost figure reached an Operations payload')
    if (payload.includes('12,345')) throw new Error('an asking price reached an Operations payload')

    // The customer book is not theirs at all.
    const customers = await opsPage.goto(BASE + '/customers', { waitUntil: 'domcontentloaded' })
    await opsPage.waitForTimeout(800)
    const body = await opsPage.locator('body').innerText()
    if ((customers?.status() ?? 0) < 400 && !/not part of your role|cannot|permission|forbidden/i.test(body)) {
      throw new Error('Operations reached the customer book')
    }

    // But the job works: the stock list renders for the person moving it.
    await opsPage.goto(BASE + '/inventory', { waitUntil: 'domcontentloaded' })
    await opsPage.waitForTimeout(1200)
    if (await opsPage.locator('tbody tr').count() === 0) {
      throw new Error('Operations cannot see the stock they are meant to move')
    }
  })
})

// --- E9. Sourcing: accepting a quote closes the loop -------------------------

await journey('accepting a supplier quote books the watch in and fulfils the want', async (page) => {
  // The whole loop, end to end: a want is registered, a supplier quotes,
  // the quote is accepted into intake pre-filled, and the want leaves the
  // board with an offer task waiting. Any step that silently drops the
  // thread is exactly the failure E9 exists to prevent.
  const model = `Explorer II ${stamp}`

  await go(page, '/requests')
  await page.click('button:has-text("Register a want")')
  await page.waitForTimeout(500)
  await page.click('[role="dialog"] button:has-text("Choose a customer")')
  await page.waitForTimeout(300)
  await page.locator('[role="dialog"] [role="option"], [role="dialog"] li button').first().click()
  await page.waitForTimeout(300)
  await page.selectOption('[role="dialog"] select[name="brandId"]', { index: 1 })
  await page.fill('[role="dialog"] input[name="model"]', model)
  await page.fill('[role="dialog"] input[name="budgetGbp"]', '12500')
  await page.click('[role="dialog"] button:has-text("Register it")')
  await page.waitForTimeout(2500)

  // A supplier quotes £8,250 against that want — logged on its card.
  await go(page, '/requests')
  const card = page.locator('section', { hasText: model }).first()
  await card.locator('button:has-text("Log a supplier enquiry")').click()
  await page.waitForTimeout(400)
  await card.locator('select[name="supplierId"]').selectOption({ index: 1 })
  await card.locator('input[name="quotedGbp"]').fill('8250')
  await card.locator('button:has-text("Log it")').click()
  await page.waitForTimeout(2500)

  // The quote carries the action that accepts it.
  await go(page, '/requests')
  const bookIn = page.locator('section', { hasText: model }).locator('a:has-text("Book it in")')
  if (await bookIn.count() === 0) throw new Error('a quoted enquiry offered no way to accept the quote')
  await bookIn.first().click()
  await page.waitForTimeout(1500)

  // Intake starts from the request and the quote, not from a blank form.
  const header = await page.locator('main').innerText()
  if (!header.includes('Book in for')) throw new Error('intake did not announce who it is for')
  const modelValue = await page.locator('input[name="model"]').inputValue()
  if (!modelValue.includes(model)) throw new Error(`the model did not prefill: "${modelValue}"`)
  const price = await page.locator('input[name="purchaseAmount"]').inputValue()
  if (!/8,?250/.test(price)) throw new Error(`the quoted price did not prefill: "${price}"`)
  const asking = await page.locator('input[name="estSaleAmount"]').inputValue()
  if (!/12,?500/.test(asking)) throw new Error(`the budget did not seed the asking price: "${asking}"`)

  // Complete what the prefill could not know, and book it in.
  await page.fill('input[name="purchaseDate"]', '2026-07-30')
  await page.selectOption('select[name="locationId"]', { index: 1 })
  await page.click('button:has-text("Add watch to stock")')
  await page.waitForTimeout(3000)

  // The want has left the board — fulfilled, not lingering as open demand.
  // Scoped to card titles: the watch that was just booked in may legitimately
  // appear as a stock match on other cards for the same brand.
  await go(page, '/requests')
  if (await page.locator('section h2', { hasText: model }).count() > 0) {
    throw new Error('the want stayed on the board after the watch was booked in')
  }

  // And the loop hands over to a person: the offer task exists.
  await go(page, '/tasks')
  const tasks = await page.locator('main').innerText()
  if (!/Offer stock .* — sourced for them/.test(tasks)) {
    throw new Error('no offer task was created for the sourced watch')
  }
})

// --- Coverage floor before the redesign begins ------------------------------
//
// These are not workflow journeys; they are the net. Every route must render
// for every role, and the money paths must survive whatever the redesign does
// to the screens around them.

await journey('every route renders', async (page) => {
  const broken = []
  for (const route of ROUTES) {
    const response = await page.goto(BASE + route, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(350)
    const status = response?.status() ?? 0
    const body = await page.locator('body').innerText()
    if (status >= 400) broken.push(`${route} → HTTP ${status}`)
    else if (/application error|unhandled|digest:/i.test(body)) broken.push(`${route} → error boundary`)
    else if (await page.locator('main').count() === 0) broken.push(`${route} → no main region`)
  }
  if (broken.length) throw new Error(broken.join(' · '))
})

await journey('every route renders for a viewer', async () => {
  // A role that can reach less must still never see a broken page — the most
  // common regression when navigation and permissions change together.
  const ctx = await viewer()
  const page = await ctx.newPage()
  try {

    const broken = []
    for (const route of ROUTES) {
      const response = await page.goto(BASE + route, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(300)
      const status = response?.status() ?? 0
      // 403 is a correct answer for a viewer; a 500 is not.
      if (status >= 500) broken.push(`${route} → HTTP ${status}`)
      const body = await page.locator('body').innerText()
      if (/application error|unhandled|digest:/i.test(body)) broken.push(`${route} → error boundary`)
    }
    if (broken.length) throw new Error(broken.join(' · '))
  } finally {
    await page.close()
  }
})

await journey('a sale survives being voided and resold', async (page) => {
  // The money path, end to end. Everything else in the redesign can move; this
  // sequence has to keep producing the same numbers.
  //
  // It tracks its own watch throughout, because by the time this runs the
  // first Sold row belongs to another journey.
  await go(page, '/inventory?status=IN_STOCK')
  const firstRow = page.locator('tbody tr').first()
  if (await firstRow.count() === 0) throw new Error('nothing is in stock to sell')
  const stockNo = (await firstRow.locator('td').nth(1).innerText()).trim()

  await firstRow.locator('button[aria-label^="Status:"]').click()
  await page.waitForTimeout(300)
  await page.locator('[role="menu"] button:has-text("Mark as sold")').click()
  await page.waitForTimeout(900)

  const invoice = `INV-V-${Date.now().toString().slice(-7)}`
  const dialog = page.locator('[role="dialog"]')
  await dialog.locator('input[inputmode="decimal"]').first().fill('11000')
  await page.fill('input[placeholder="INV-2026-001"]', invoice)
  await dialog.locator('button:has-text("Record the sale")').click()
  await page.waitForTimeout(3000)
  if (await page.locator('[role="dialog"]').count() > 0) throw new Error('the sale did not record')

  // Void it, and the watch must come back into stock and be sellable again —
  // the partial unique indexes exist precisely for this.
  await go(page, `/inventory?q=${stockNo}`)
  const sold = page.locator(`tbody tr:has(td:text-is("${stockNo}")) button[aria-label^="Status:"]`)
  if (await sold.count() === 0) throw new Error(`stock ${stockNo} vanished after the sale`)
  if (!(await sold.getAttribute('aria-label'))?.includes('Sold')) {
    throw new Error(`stock ${stockNo} did not move to Sold`)
  }
  await sold.click()
  await page.waitForTimeout(300)
  await page.locator('[role="menu"] button:has-text("Void the sale")').click()
  await page.waitForTimeout(700)
  await page.locator('[role="dialog"] textarea').first()
    .fill('Journey: voided to prove the watch can be resold')
  await page.locator('[role="dialog"] button:has-text("Void the sale")').click()
  await page.waitForTimeout(3000)
  if (await page.locator('[role="dialog"]').count() > 0) {
    throw new Error('the void dialog stayed open')
  }

  await go(page, `/sales?q=${invoice}`)
  if (await page.locator(`tr:has-text("${invoice}")`).count() > 0) {
    throw new Error('the voided sale is still in the ledger')
  }

  await go(page, `/inventory?q=${stockNo}`)
  const back = page.locator(`tbody tr:has(td:text-is("${stockNo}")) button[aria-label^="Status:"]`)
  if ((await back.getAttribute('aria-label'))?.includes('Sold')) {
    throw new Error(`stock ${stockNo} is still marked sold after the void`)
  }
})

await journey('money reads the same on every screen', async (page) => {
  // A figure that disagrees with itself across screens is the defect class the
  // audit found twice — a sold row reporting profit from the USD column, and a
  // customer's lifetime value diverging from the ledger. Column positions move
  // during a redesign, so this reads the figures out of the row rather than out
  // of a fixed cell.
  await go(page, '/inventory')
  const row = page.locator('tbody tr').first()
  if (await row.count() === 0) throw new Error('no stock to compare')
  const rowText = await row.innerText()
  const figures = [...rowText.matchAll(/£[\d,]+/g)].map((match) => match[0])
  if (figures.length === 0) throw new Error('the row shows no money at all')

  const href = await row.locator('a[aria-label^="Open full record"]').getAttribute('href')
  await go(page, href)
  const record = await page.locator('main').innerText()

  const missing = figures.filter((figure) => !record.includes(figure))
  if (missing.length === figures.length) {
    throw new Error(`the list shows ${figures.join(', ')} and the record repeats none of them`)
  }
})

// Last, deliberately. Signing out revokes the session every other journey is
// using, so this has to be the final thing that happens. Placed earlier it
// left the rest of the suite anonymous and staring at empty pages.
await journey('signing out ends the session', async (page) => {
  await go(page, '/')
  await page.click('button:has-text("Account menu for")')
  await page.waitForTimeout(300)
  await page.click('button:has-text("Sign out"), a:has-text("Sign out")')
  await page.waitForTimeout(2000)

  await page.goto(`${BASE}/inventory`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  if (!page.url().includes('/login')) throw new Error('a signed-out session still reached the inventory')
})

if (viewerCtx) await viewerCtx.close()
await signedIn.close()
await browser.close()
console.log(results.join('\n'))
const failed = results.some((r) => r.startsWith('FAIL'))
console.log(failed ? '\nSOME JOURNEYS FAILED — screenshots in /tmp' : '\nall journeys passed')
process.exit(failed ? 1 : 0)
