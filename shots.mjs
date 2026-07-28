import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'
const width = Number(process.argv[2] ?? 1440)
const tag = process.argv[3] ?? 'd'
const which = process.argv[4]

const PAGES = [
  ['dashboard', '/'], ['inventory', '/inventory'], ['new', '/inventory/new'],
  ['import', '/inventory/import'], ['sales', '/sales'], ['reports', '/reports'],
  ['ageing', '/reports/ageing'], ['suppliers', '/suppliers'], ['locations', '/locations'],
  ['settings', '/settings'], ['currencies', '/settings/currencies'], ['users', '/settings/users'],
  ['audit', '/settings/audit'], ['profile', '/settings/profile'],
  ['notifications', '/notifications'], ['help', '/help'], ['notfound', '/nope'],
]

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-proxy-server'],
})
const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 2 })
{
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await p.fill('input[type="email"]', 'alex@bluecroft.co.uk')
  await p.fill('input[type="password"]', 'Bluecroft2026!')
  await p.click('button[type="submit"]')
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 })
  await p.close()
}

for (const [name, url] of PAGES) {
  if (which && name !== which) continue
  const page = await ctx.newPage()
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1400)
  await page.screenshot({ path: `/tmp/qa/${tag}-${name}.png`, fullPage: true })
  await page.close()
}
await ctx.close()
await browser.close()
console.log('captured')
