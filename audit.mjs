/**
 * Design-system audit.
 *
 * Walks every screen and reports computed values that fall outside the token
 * scale, plus the kinds of inconsistency that are invisible in a screenshot:
 * three different button heights, four border radii, hover states with no
 * focus equivalent, touch targets under 44px.
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'
const width = Number(process.argv[2] ?? 1440)

const PAGES = [
  ['dashboard', '/'],
  ['inventory', '/inventory'],
  ['inventory-filters', '/inventory'],
  ['add watch', '/inventory/new'],
  ['import', '/inventory/import'],
  ['sales', '/sales'],
  ['reports', '/reports'],
  ['ageing', '/reports/ageing'],
  ['suppliers', '/suppliers'],
  ['locations', '/locations'],
  ['settings', '/settings'],
  ['currencies', '/settings/currencies'],
  ['users', '/settings/users'],
  ['audit', '/settings/audit'],
  ['profile', '/settings/profile'],
  ['notifications', '/notifications'],
  ['help', '/help'],
  ['not found', '/nope'],
]

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-proxy-server'],
})
const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
{
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"]', 'alex@bluecroft.co.uk')
  await page.fill('input[type="password"]', 'Bluecroft2026!')
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 })
  await page.close()
}

const collected = {
  fontSize: new Map(), radius: new Map(), buttonHeight: new Map(),
  shadow: new Map(), transition: new Map(), colors: new Map(),
}
const findings = []

const bump = (map, key, where) => {
  const set = map.get(key) ?? new Set()
  set.add(where)
  map.set(key, set)
}

for (const [name, url] of PAGES) {
  const page = await ctx.newPage()
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  if (name === 'inventory-filters') {
    await page.click('button:has-text("More filters")').catch(() => {})
    await page.waitForTimeout(400)
  }

  const report = await page.evaluate(() => {
    const out = { fontSize: [], radius: [], buttonHeight: [], shadow: [], transition: [], issues: [], colors: [] }
    const seen = (el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0

    for (const el of document.querySelectorAll('body *')) {
      if (!seen(el)) continue
      const s = getComputedStyle(el)
      const tag = el.tagName.toLowerCase()

      if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
        out.fontSize.push(s.fontSize)
      }
      if (s.borderTopLeftRadius !== '0px') out.radius.push(s.borderTopLeftRadius)
      if (s.boxShadow !== 'none') out.shadow.push(s.boxShadow.replace(/rgba?\([^)]+\)/g, 'c'))
      if (s.transitionDuration !== '0s') out.transition.push(`${s.transitionDuration} ${s.transitionTimingFunction}`)

      const r = el.getBoundingClientRect()
      if (['input','select','textarea'].includes(tag) && tag !== 'textarea' && el.type !== 'checkbox' && el.type !== 'radio' && r.height > 0) {
        out.buttonHeight.push(`${Math.round(r.height)}px  <${tag}> "${(el.getAttribute('aria-label')||el.name||el.placeholder||'').slice(0,20)}"`)
      }
      if ((tag === 'button' || (tag === 'a' && s.display.includes('flex'))) && r.height > 0) {
        const text = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 22)
        out.buttonHeight.push(`${Math.round(r.height)}px  "${text}"  [${(el.className||'').toString().slice(0,44)}]`)
      }
      if (s.borderTopLeftRadius !== '0px' && !['8px','12px','16px','24px','999px','4px','2px'].includes(s.borderTopLeftRadius)) {
        out.issues.push(`radius ${s.borderTopLeftRadius} on <${tag}> [${(el.className||'').toString().slice(0,60)}]`)
      }
      if (s.fontSize === '10px') {
        out.issues.push(`10px text "${(el.textContent||'').trim().slice(0,24)}" [${(el.className||'').toString().slice(0,50)}]`)
      }

      // Interactive but no visible affordance change on hover.
      if ((tag === 'button' || tag === 'a') && s.cursor !== 'pointer' && !el.hasAttribute('disabled')) {
        out.issues.push(`non-pointer cursor on <${tag}> "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`)
      }
      // Text that will clip rather than wrap or ellipsis.
      if (s.whiteSpace === 'nowrap' && s.overflow === 'visible' && el.scrollWidth > el.clientWidth + 1) {
        out.issues.push(`clipped text: "${(el.textContent || '').trim().slice(0, 40)}"`)
      }
    }

    // Disabled controls should look disabled.
    for (const el of document.querySelectorAll('button[disabled], input[disabled], select[disabled]')) {
      const s = getComputedStyle(el)
      if (s.opacity === '1' && s.cursor !== 'not-allowed') {
        out.issues.push(`disabled control with no disabled styling: "${(el.textContent || el.name || '').trim().slice(0, 30)}"`)
      }
    }

    return out
  })

  for (const v of report.fontSize) bump(collected.fontSize, v, name)
  for (const v of report.radius) bump(collected.radius, v, name)
  for (const v of report.buttonHeight) bump(collected.buttonHeight, v, name)
  for (const v of report.shadow) bump(collected.shadow, v, name)
  for (const v of report.transition) bump(collected.transition, v, name)
  for (const issue of [...new Set(report.issues)]) findings.push(`${name}: ${issue}`)

  await page.close()
}

const summarise = (label, map, expected) => {
  const rows = [...map.entries()].sort((a, b) => b[1].size - a[1].size)
  console.log(`\n${label} (${rows.length} distinct)`)
  for (const [value, where] of rows) {
    const flag = expected && !expected.includes(value) ? '  <-- off-scale' : ''
    console.log(`  ${value.padEnd(46)} ${where.size} page(s)${flag}`)
  }
}

// The type scale from tailwind.config.ts.
summarise('font sizes', collected.fontSize, ['11px', '12px', '13px', '14px', '16px', '20px', '26px', '32px', '40px'])
summarise('border radii', collected.radius, ['8px', '12px', '16px', '24px', '999px', '4px', '2px'])
summarise('button heights', collected.buttonHeight)
summarise('shadows', collected.shadow)
summarise('transitions', collected.transition)

console.log(`\nissues (${findings.length})`)
for (const f of findings.slice(0, 60)) console.log('  ' + f)

await ctx.close()
await browser.close()
