'use client'
import { createContext, useContext } from 'react'

export interface BrandAssets {
  /** Is `public/brand/wordmark.svg` actually on disk? */
  wordmark: boolean
  /** Is `public/brand/monogram.svg` actually on disk? */
  monogram: boolean
}

/**
 * Neither, until the root layout says otherwise. A default of "present"
 * would put the broken image back on any tree that forgot the provider.
 */
const BrandContext = createContext<BrandAssets>({ wordmark: false, monogram: false })

/**
 * Which brand files exist, answered on the server and handed to the client.
 *
 * The sidebar and the bars are client components, so they cannot look at the
 * filesystem themselves; the root layout does it once per render and passes
 * the two booleans down. This replaced a pair of `data-` attributes and a CSS
 * rule that hid whichever mark was wrong — which did stop the broken glyph
 * appearing, but not the request behind it: `display: none` does not stop a
 * browser fetching an `<img>`, so every page was quietly firing off five
 * 404s for a file that was known not to be there. With the answer in the
 * tree the element is never written at all.
 */
export function BrandProvider({ value, children }: { value: BrandAssets; children: React.ReactNode }) {
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>
}

export function useBrandAssets(): BrandAssets {
  return useContext(BrandContext)
}
