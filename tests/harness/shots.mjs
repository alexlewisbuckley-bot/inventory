/**
 * Screenshot sweep.
 *
 * Captures every route at a viewport and theme so a redesign can be reviewed
 * as a diff rather than from memory. Written to /tmp/qa/<tag>-<route>.png.
 */
import { BASE, ROUTES, launch, signIn } from './browser.mjs'

const width = Number(process.argv[2] ?? 1440)
const tag = process.argv[3] ?? 'd'
const only = process.argv[4]
const theme = process.argv.includes('--dark') ? 'dark' : 'light'

const { browser, ctx } = await launch({ width, height: 1000, colorScheme: theme })
await signIn(ctx)

for (const url of ROUTES) {
  const name = url === '/' ? 'dashboard' : url.replace(/^\//, '').replace(/\//g, '-')
  if (only && name !== only) continue
  const page = await ctx.newPage()
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `/tmp/qa/${tag}-${name}.png`, fullPage: true })
  await page.close()
}

await ctx.close()
await browser.close()
console.log('captured')
