/**
 * Computed-style audit.
 *
 * Screenshots show what a page looks like; they do not tell you the page
 * contains eleven button heights. This walks the rendered DOM of every route
 * and reports the distinct values actually in use for the properties the
 * design system constrains.
 *
 * From E7 onward this fails the build. Until then it records a baseline.
 */
import { readFileSync } from 'node:fs'
import { signIn, ROUTES, launch } from './browser.mjs'

const ALLOWED = JSON.parse(readFileSync(new URL('./tokens.json', import.meta.url), 'utf8'))
const strict = process.argv.includes('--strict')

const { browser, ctx } = await launch({ width: 1440, height: 1000 })
await signIn(ctx)

const tally = { fontSize: {}, radius: {}, controlHeight: {}, shadow: {}, colour: {}, fontWeight: {} }
const bump = (bucket, key, where) => {
  const entry = (tally[bucket][key] ??= { count: 0, where: new Set() })
  entry.count += 1
  entry.where.add(where)
}

for (const url of ROUTES) {
  const page = await ctx.newPage()
  await page.goto(`http://localhost:3000${url}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)

  const found = await page.evaluate(() => {
    const out = { fontSize: [], radius: [], controlHeight: [], shadow: [], colour: [], fontWeight: [] }
    for (const el of document.querySelectorAll('body *')) {
      const box = el.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      const s = getComputedStyle(el)
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      if (hasText) {
        out.fontSize.push(s.fontSize)
        out.fontWeight.push(s.fontWeight)
        out.colour.push(s.color)
      }
      if (s.borderTopLeftRadius !== '0px') out.radius.push(s.borderTopLeftRadius)
      if (s.boxShadow !== 'none') out.shadow.push(s.boxShadow)
      const tag = el.tagName
      // The control scale covers chrome-sized controls only. A checkbox is
      // intrinsically 16px, a textarea grows with its content, and a card
      // acting as a button is a surface — none of them are on the scale, and
      // counting them buries the drift that matters in noise.
      const onScale = tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT'
      if (onScale && box.height >= 28 && box.height <= 60) {
        out.controlHeight.push(`${Math.round(box.height)}px`)
      }
    }
    return out
  })

  for (const [bucket, values] of Object.entries(found)) {
    for (const value of values) bump(bucket, value, url)
  }
  await page.close()
}

await ctx.close()
await browser.close()

let failures = 0
for (const [bucket, rows] of Object.entries(tally)) {
  const allowed = ALLOWED[bucket]
  const entries = Object.entries(rows).sort((a, b) => b[1].count - a[1].count)
  const offenders = allowed ? entries.filter(([value]) => !allowed.includes(value)) : []
  console.log(`\n${bucket} — ${entries.length} distinct${allowed ? `, ${offenders.length} off-token` : ''}`)
  for (const [value, { count, where }] of entries.slice(0, 30)) {
    const off = allowed && !allowed.includes(value) ? '  ✗' : ''
    const pages = [...where]
    console.log(`  ${String(count).padStart(5)}  ${value}${off}${pages.length <= 3 ? `   (${pages.join(', ')})` : ''}`)
  }
  failures += offenders.length
}

if (strict && failures > 0) {
  console.error(`\n${failures} value(s) outside the token set. See design-system-v2.md.`)
  process.exit(1)
}
console.log(failures > 0 ? `\n${failures} off-token value(s) — baseline only` : '\nall values on token')
