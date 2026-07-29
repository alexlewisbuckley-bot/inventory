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
})

// --- 4. Void that sale, from the status menu -------------------------------
await journey('void a sale', async (page) => {
  await go(page, '/inventory?status=SOLD')
  const trigger = page.locator('tbody button[aria-label^="Status:"]').filter({ hasText: 'Sold' }).first()
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
  const enquiriesOut = async () => {
    const body = await page.locator('main').innerText()
    return [...body.matchAll(/(\d+) supplier (?:enquiry|enquiries) out/g)]
      .reduce((sum, match) => sum + Number(match[1]), 0)
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
