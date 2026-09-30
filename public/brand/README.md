# Brand artwork

Two files, and the application picks them up with no code change.

| File | What it is | Where it appears |
| --- | --- | --- |
| `wordmark.svg` | The one-line lockup — ONE STREET WATCHES | Sidebar, top bar, mobile sheet, login panel, trade partner bar |
| `monogram.svg` | The interlocking OS symbol | Browser tab and bookmark, and the sidebar when it is collapsed |

Both are the supplied artwork from the brand guidelines. They are never
retyped or redrawn — until they are here, the application typesets the name
in the house manner instead, which is deliberately not a reproduction of the
mark.

## What they need to be

- **SVG**, with the artwork as paths. Outlined, not live text, so the file does
  not depend on a font being installed.
- **A transparent background**, and the mark in a single solid ink
  (`#1C1B19`). One colour, so the dark theme can invert it rather than needing
  a second file.
- **A tight `viewBox`** — cropped to the artwork with no built-in padding.
  Space around the mark is set in the layout, where it can respond to the
  screen; baked into the file it cannot.
- No `width`/`height` attributes on the root `<svg>`. The components size it.

Drop them in this directory with exactly those names. Nothing else to do: the
`Wordmark` component swaps from the typeset name to the artwork on its own,
and the favicon starts resolving.
