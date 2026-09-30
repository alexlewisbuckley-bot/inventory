import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const config = readFileSync(join(root, 'next.config.mjs'), 'utf8')
const brand = readFileSync(join(root, 'src/lib/brand.ts'), 'utf8')

describe('brand artwork', () => {
  /**
   * The bug this guards against shipped once and was invisible locally: the
   * artwork was asked for from the filesystem while the page was rendering,
   * which is fine on a machine serving the application out of its own
   * directory and false everywhere it is deployed, because `public/` is
   * served by the static layer and is not in the serverless bundle. The
   * wordmark downloaded fine over HTTP and every bar still showed the
   * typeset fallback.
   */
  it('is not looked for on the filesystem at request time', () => {
    expect(brand).not.toMatch(/node:fs|from 'fs'|existsSync|readFile/)
  })

  it('is looked for during the build, once per file', () => {
    expect(config).toMatch(/existsSync/)
    expect(config).toMatch(/BRAND_WORDMARK/)
    expect(config).toMatch(/BRAND_MONOGRAM/)
  })

  /**
   * Both marks are one solid ink on a transparent ground with the artwork
   * outlined, because the dark theme inverts the file rather than swapping
   * in a second one, and outlines mean the mark does not depend on a font.
   */
  it.each(['wordmark.svg', 'monogram.svg'])('%s is a single-ink outlined SVG', (file) => {
    const path = join(root, 'public', 'brand', file)
    if (!existsSync(path)) return // not supplied yet: the typeset name stands in
    const svg = readFileSync(path, 'utf8')
    expect(svg).not.toMatch(/<text|<image|<script/)
    expect(svg).toMatch(/viewBox="/)
    expect(new Set(svg.match(/fill="#[0-9A-Fa-f]{6}"/g) ?? [])).toHaveProperty('size', 1)
  })
})
