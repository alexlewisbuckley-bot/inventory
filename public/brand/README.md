# Brand artwork

Two files, and the application picks them up with no code change.

| File | What it is | Status | Where it appears |
| --- | --- | --- | --- |
| `wordmark.svg` | The stacked lockup — ONE STREET over WATCHES | **Supplied** | Sidebar, top bar, mobile sheet, sign-in panel, trade partner bar |
| `monogram.svg` | The interlocking OS symbol | **Supplied** | Browser tab and bookmark, and the sidebar when it is collapsed |

Both are the supplied artwork from the brand guidelines. They are never
retyped or redrawn — until one is here, the application typesets the name in
the house manner instead, which is deliberately not a reproduction of the
mark. The two are checked for independently, so having one and not the other
is a supported state: whichever is missing falls back to the name, and the
browser tab keeps its default icon rather than pointing at a file that is not
there.

That check happens **during the build**, in `next.config.mjs`, and is inlined
into the bundle. It must not move back to request time: `public/` is served by
the static layer and is not in the serverless bundle, so a runtime check
answers "absent" in production no matter what is deployed. `tests/brand-assets.test.ts`
holds that line.

## What they need to be

- **SVG**, with the artwork as paths. Outlined, not live text, so the file
  does not depend on a font being installed. The supplied wordmark is 16
  paths.
- **A transparent background**, and the mark in a single solid ink. One
  colour, so a theme can invert it rather than needing a second file. The
  supplied wordmark is `#0C0908`.
- **A tight `viewBox`** — cropped to the artwork with no built-in padding.
  Space around the mark is set in the layout, where it can respond to the
  screen; baked into the file it cannot.

`width` and `height` on the root `<svg>` are fine — the component states both
dimensions itself, because an image left to size itself is stretched by a
column flex before its own proportions get a say. If the artwork's proportions
change, the numbers in `Wordmark.tsx` change with it. The supplied wordmark is
620×130, drawn at 162×34; the monogram is 216×250 — taller than it is wide —
drawn at 28×32.

Drop a file in this directory with exactly the name above. Nothing else to do:
the `Wordmark` component swaps from the typeset name to the artwork on its
own, and the favicon starts resolving.

## wordmark-line.svg

The one-line lockup, 560 × 37, drawn in house olive (#454830). The guidelines
give this one website navigation and the business-card web line; the stacked
`wordmark.svg` above is a different lockup and is not a substitute for it.

It is in this repository for a reason that has nothing to do with the
application: Shopify theme files are hand-transcribed through the API from a
machine with no network, and 16KB of path coordinates does not survive that
trip. Served from here over HTTP, Shopify fetches the file itself and nothing
is retyped. `assets/osw-logo.svg` in the theme is a copy taken that way.
