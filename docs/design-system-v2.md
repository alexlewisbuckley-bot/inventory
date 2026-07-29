# Bluecroft Design System — Version 2

**Date:** 29 July 2026
**Status:** Specification. No screens, no implementation.
**Inputs:** `docs/product-audit-2026-07.md` · `docs/ux-strategy-2026-07.md`
**Standard:** Linear · Attio · Stripe Dashboard · Notion

---

## 0. What V2 changes, and why there is a V2 at all

V1 is more disciplined than most products of this size: eight type sizes, five
radii, two shadows, one focus treatment, 44px form controls, 36px chrome. That
restraint is the reason a V2 is worth writing rather than a rewrite being
needed — the foundations hold.

V2 exists because the strategy asks the interface to do three things V1 was not
built for:

1. **Density.** The strategy is keyboard-first and list-heavy. V1's single
   44px control height is correct for forms and wrong for a table row you will
   see forty of. V2 introduces a control **scale**, not a control size.
2. **Surfaces V1 does not have.** Command palette, peek overlay, inline edit,
   filter chips, bulk-action bar, skeletons. Each was improvised or missing.
3. **Charts.** V1 has two series colours and no chart specification at all.
   An insights section cannot be built on that.

Everything else in V2 is either unchanged from V1 or a correction the audit
named. Where a token survives unchanged it is marked **=**; where it changes,
the reason is given.

---

## 1. Foundations

### 1.1 Typography

One family. **Plus Jakarta Sans**, self-hosted as a weight-variable woff2 —
already true in V1 and non-negotiable: a webfont fetched from a third party is
a privacy exposure, a render-blocking request and a silent fallback the moment
it is blocked.

Nine steps. Two more than V1, both at the small end, because a dense product
needs the bottom of the scale more than the top.

| Token | Size / line | Tracking | Weight | Use |
|---|---|---|---|---|
| `display` | 40 / 48 | −0.025em | 800 | Hero figure on Today. One per screen, at most. |
| `h1` | 32 / 40 | −0.02em | 800 | Page title |
| `h2` | 26 / 34 | −0.015em | 800 | Section title |
| `h3` | 20 / 28 | −0.01em | 700 | Card title, record name |
| `body-lg` | 16 / 26 | 0 | 400–700 | Long-form prose only |
| `body` | 14 / 22 | 0 | 400–700 | Default. Forms, record fields |
| `small` | 13 / 20 | 0 | 400–700 | **Table rows, list rows, dense UI** |
| `caption` | 12 / 18 | 0 | 400–600 | Labels, metadata, hints |
| `micro` | 11 / 16 | +0.04em | 600 | Chips, keyboard hints, column heads |

**Weights: 400, 500, 600, 700, 800.** Five, and no more. 500 is for a value
that must read as a value without shouting; 800 is reserved for headings and
hero figures.

**Numerals.** Every figure — money, counts, dates, percentages — uses
`font-variant-numeric: tabular-nums`. Not a suggestion: a column of proportional
digits cannot be scanned, and this is a product where the digits are the point.
The rule is enforced at the `Table` and `StatTile` level so it cannot be
forgotten.

**Line length.** Prose is capped at 68 characters. Nothing else is prose.

*Changed from V1:* `small` is promoted from an occasional size to the default
for dense surfaces. `body` remains the form default. This single change is what
makes a 36px table row legible.

### 1.2 Spacing

A 4px base, and only these steps:

`4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80 · 96 · 120` **=**

Unchanged from V1 because it is right. Two rules govern its use:

- **Inside a component: 4–16.** Gaps larger than 16 inside a component mean the
  component is two components.
- **Between components: 16–32. Between sections: 40–64.** A page that needs 80
  between two things is a page that needs a divider or two pages.

**The density multiplier.** Comfortable is the values above. Compact multiplies
vertical padding by 0.75 and leaves horizontal padding alone — the eye tracks
columns horizontally and rows vertically, so only one axis should compress.
V1 offered the preference and honoured it in one component; V2 applies it at
the token layer so every surface inherits it. *(Audit M-9.)*

### 1.3 Grid

**12 columns, 24px gutter, 1440px maximum content width, 1200px maximum
reading width.**

| Breakpoint | Width | Columns | Rail | Notes |
|---|---|---|---|---|
| `sm` | <640 | 4 | Hidden, sheet | Consultation only (strategy §16) |
| `md` | 640–1023 | 8 | Icons only, 64px | Tablet |
| `lg` | 1024–1439 | 12 | 224px | The working width |
| `xl` | ≥1440 | 12 | 224px | Content caps; the rest is margin |

**Record layout is 8/4** — timeline left, facts right — collapsing to stacked
tabs below `lg`.
**List layout is full-bleed inside the content area.** A table in a card with
padding wastes the two things a list needs most: width and rows.

**Ultra-wide is not an opportunity.** Beyond 1440 the content stops growing.
A 2560px-wide table is unreadable; the answer is more rows, not longer ones.

### 1.4 Border radius

Five steps. **=**

| Token | Value | Applied to |
|---|---|---|
| `xs` | 4px | Checkboxes, tags inside dense rows |
| `sm` | 8px | Inputs inside composites, small buttons, menu items |
| `md` | 12px | Inputs, selects, cards inside cards, popovers |
| `lg` | 16px | Cards, panels, modals, drawers |
| `pill` | 999px | Buttons, chips, avatars |

**The rule that keeps it coherent:** a nested element's radius is one step below
its parent's. A 12px input inside a 16px card; an 8px menu item inside a 12px
popover. Equal radii nested look like a mistake because they are one.

### 1.5 Elevation

Elevation is **hierarchy of interruption**, not decoration. Four levels, and a
component may not invent a fifth.

| Token | Shadow | Means | Used by |
|---|---|---|---|
| `flat` | none, 1px border | On the page | Table, list row, inline card |
| `card` | `0 2px 8px shadow/0.06` | Contained | Card, stat tile |
| `raised` | `0 4px 16px shadow/0.10` | Floating, dismissible | Popover, menu, tooltip, toast |
| `overlay` | `0 20px 60px -10px shadow/0.30` | Blocking | Modal, command palette |
| `drawer` | `-12px 0 40px -8px shadow/0.25` | Blocking, edge-anchored | Drawer, mobile sheet |

**In dark mode, shadows carry almost no information** — a shadow on a dark
surface is invisible. Dark mode therefore expresses the same hierarchy with
**surface lightness plus a 1px border**, not with shadow. Reusing the light
shadows in dark is the most common way a dark theme reads as flat and cheap.

### 1.6 Colour

Colour is defined as **ramps**, and everything else — semantic tokens, chart
palettes, status — is a named step from a ramp. Nothing in a component ever
references a hex.

**Ramps.** Navy (brand, structural), Teal (accent, action), and neutral Slate.
Status hues sit outside the ramps deliberately (§1.6.3).

```
navy    900 #04173A   700 #012D68   500 #1E4E9D   300 #6E93D6   100 #E2EBF9
teal    600 #00A8B0   500 #00C2CB   300 #6FE0E5   100 #D9F6F7
slate   900 #0A1F44   700 #51617D   500 #8B9BB4   300 #C6D3E4   100 #E3EAF3   050 #F5F8FC
```

#### 1.6.1 Semantic tokens

Components reference only these. The name says the job, never the colour —
`surface-raised`, not `white` — which is what makes dark mode a re-mapping
rather than a rewrite.

| Token | Light | Dark | Job |
|---|---|---|---|
| `surface-page` | `#FFFFFF` | `#071023` | The page beneath everything |
| `surface-subtle` | `#F5F8FC` | `#0B1730` | Recessed: list backgrounds, wells |
| `surface-raised` | `#FFFFFF` | `#0E1B33` | Cards, tables, popovers |
| `surface-overlay` | `#FFFFFF` | `#13223D` | Modals, palette — one step above raised |
| `surface-inverse` | `#04173A` | `#E2EBF9` | Tooltips, inverted chips |
| `content-primary` | `#0A1F44` | `#E2EBF9` | Body text, values |
| `content-secondary` | `#51617D` | `#93A7C4` | Labels, metadata |
| `content-muted` | `#7A8AA5` | `#6C7F9C` | Placeholders, disabled |
| `content-accent` | `#007A80` | `#4FD9E0` | Links, accent text |
| `line-subtle` | `#E3EAF3` | `#1C2C4A` | Dividers, resting borders |
| `line-strong` | `#C6D3E4` | `#2A3E63` | Hover borders, emphasis |
| `focus` | `#00C2CB` | `#00C2CB` | The focus ring, both modes |

**`content-muted` is new in V2.** V1 had two ink levels and used
`content-secondary` for both metadata and placeholders, which made empty inputs
look filled. Three levels: what you read, what you consult, what is not there
yet.

#### 1.6.2 Interaction states

State is expressed by **one property changing by one step** — not by a new
colour. Applies to every interactive element without exception.

| State | Expression |
|---|---|
| Rest | As specified |
| Hover | Background −1 step, or border `subtle → strong` |
| Active/pressed | Background −2 steps, no transform |
| Focus-visible | `2px solid focus`, `outline-offset: 2px`. Nothing else changes. |
| Selected | `surface-subtle` background + 2px accent left rail |
| Disabled | `opacity: 0.5`, `cursor: not-allowed`, no hover |
| Loading | Content stays, spinner replaces the icon, width does not change |
| Danger | Border and text `state-critical`; background only on the final commit |

**One focus treatment for the whole product** — a 2px teal outline with 2px
offset, on both themes. V1 arrived here after trying a ring with an offset
colour, which painted a white halo on tinted surfaces. It is settled; do not
reopen it.

**Never move an element on press.** A 1px translate feels responsive on a
marketing page and feels broken in a list you are arrow-keying through.

#### 1.6.3 Status

Four states, reserved. **A status colour is never used for anything else** —
not a series, not a brand accent, not an emphasis.

| Status | Light | Dark | Ink on tint | Means |
|---|---|---|---|---|
| `good` | `#00875A` | `#3DD68C` | tint at 12% | Complete, paid, healthy |
| `warning` | `#B26A00` | `#F5B841` | tint at 14% | Ageing, due soon, attention |
| `serious` | `#C2410C` | `#FB923C` | tint at 12% | Overdue, blocked |
| `critical` | `#A31409` | `#F97066` | tint at 12% | Failed, void, error |

**Four, not three.** V1 collapsed serious and critical into one danger colour,
which meant an overdue task and a failed migration looked identical. The
distinction is *someone should act* versus *something is broken*.

**Colour never carries status alone.** Every status ships with an icon and a
word. This is a hard accessibility rule (§6) and also a plain legibility one —
a red dot means nothing at a glance in a product with four reds.

#### 1.6.4 Chart colour

Computed, not chosen. Both palettes below were run through the six-check
validator against this system's actual surfaces and **pass all five checks.**

**Categorical — light, on `surface-raised` #FFFFFF.** Assigned in this fixed
order, never cycled.

| Slot | Hex | Name |
|---|---|---|
| 1 | `#1E4E9D` | Navy |
| 2 | `#C2417F` | Magenta |
| 3 | `#B27300` | Amber |
| 4 | `#0097A7` | Teal |
| 5 | `#7A5AF8` | Violet |
| 6 | `#41752F` | Olive |

**Categorical — dark, on `surface-raised` #0E1B33.** Selected steps, not a
flip. An automatically lightened light palette fails the lightness band.

| Slot | Hex |
|---|---|
| 1 | `#4F86DB` |
| 2 | `#D66594` |
| 3 | `#B58012` |
| 4 | `#17A0A0` |
| 5 | `#B072E8` |
| 6 | `#63A83C` |

**Validator output, both modes, adjacent pairs:** lightness band PASS · chroma
floor PASS · CVD separation PASS · normal-vision floor PASS · contrast ≥3:1
PASS.

**The constraint that comes with it, and it is a real one.** Running the same
validator with `--pairs all` — every pair, not just neighbours — the six-slot
palette **fails**, in both themes. So does every five-slot and every four-slot
subset of it. Exactly three three-slot subsets pass, and slots 1–3 are one of
them. That is why the order is navy, magenta, amber, and it is the whole reason
`CHART_SAFE_SLOTS` exists in `src/lib/tokens.ts`.

What defeats a fourth hue is protanopia, not taste. Navy, teal and violet
collapse into one another (ΔE 2.7 at worst, dark surface); amber and olive
collapse into each other (ΔE 5.1, light surface). No re-stepping fixes it: the
lightness band is only so wide, and six mutually distinguishable hues do not fit
inside it. Anyone who tells you otherwise has not run the numbers.

Therefore, non-negotiably:

- **Two or more series: a legend, always.**
- **Four or more series: direct labels, texture, or small multiples** as well.
  Four series distinguished by hue alone is not an accessible chart, whatever
  it looks like to the person who built it.
- The first draft of the dark palette put navy, teal and violet at ΔE 8.8 and
  passed the adjacent check. It was wrong, and the all-pairs run is what caught
  it. Re-run both modes and both pair modes after touching any slot.

**Sequential** — one hue, light to dark, five steps. Navy:
`#E2EBF9 · #B8CCEC · #6E93D6 · #2E63B0 · #012D68`. Never a rainbow.

**Diverging** — two poles and a *neutral* midpoint, for margin, variance and
anything that can be negative. Light:
`#B42318 · #E88B84 · #E3EAF3 · #6FA8C9 · #12557E`. Dark:
`#F97066 · #C55852 · #3E4650 · #4F92B8 · #8AC2E2`. Never a hue at the middle —
the midpoint's chroma is held below 0.04 in OKLab and tested, because a tinted
midpoint invents a third category out of "no signal". The ramp is lightest at
the centre on a light surface and darkest at the centre on a dark one.

**A seventh series does not exist.** It becomes "Other", small multiples, or a
different chart. Generating an eighth hue is how a palette stops being
accessible.

**Rules that apply to every chart**, without exception:
- **One y-axis.** Two measures of different scale become two charts, small
  multiples, or an indexed series. Dual axes are the single most common chart
  lie.
- **Colour follows the entity, not its rank.** Filtering out a series must not
  repaint the survivors.
- **Text wears text tokens.** Values, labels and legends are ink; the coloured
  mark beside them carries identity.
- **Marks are thin.** 2px lines, ≥8px markers, 4px rounded data-ends anchored
  to the baseline, a 2px surface gap between adjacent and stacked fills.
- **Grid and axes are recessive** — `line-subtle`, and no vertical gridlines
  on a time series.
- **Hover is not optional.** Crosshair and tooltip on line and area; per-mark
  tooltip on bar, dot and cell. The only exception is a stat tile with no plot.
- **Every chart has a table view**, reachable by keyboard. A chart nobody can
  read is a chart nobody can audit.

### 1.7 Dark mode

**Selected, not derived.** Every dark value in this document was chosen and
checked against the dark surface. Inverting lightness produces muddy chroma,
invisible shadows and unreadable charts.

Three rules:

1. **Elevation is lightness, not shadow** (§1.5). `page → subtle → raised →
   overlay` climbs 7% lightness per level, each with a `line-subtle` border.
2. **Chroma comes down, never up.** Saturated colour on a dark surface
   vibrates. Accents move toward their 300 step; backgrounds toward 900.
3. **Pure black and pure white are banned.** `#071023` and `#E2EBF9`. Maximum
   contrast is not maximum readability — it is eye strain over an eight-hour
   day, which is exactly how long this product is open.

Theme is applied before paint by an inline script (already true in V1 and worth
protecting: a dark-mode user seeing a white flash on every navigation is the
detail that says "web page", not "application").

---

## 2. Component library

Every component below specifies: **anatomy · variants · sizes · states ·
keyboard · when not to use it.** The last is the most useful line and the one
usually omitted.

### 2.1 Button

**Variants.** `primary` (one per view — the thing this screen is for),
`secondary` (outline; the alternative), `ghost` (no chrome; cancel, tertiary),
`danger` (destructive commit only), `subtle` (filled neutral; toolbar).

**Sizes.** `sm` 32px · `md` 40px · `lg` 44px.
*Changed from V1:* the default drops from 44 to 40, and `sm` from 36 to 32.
44px stays as `lg` for the primary action on a form and for every touch target
on a phone. A dense toolbar of 44px buttons dominates a screen that is
supposed to be about the data.

**Anatomy.** Icon 16px · 8px gap · label · optional trailing shortcut hint in
`micro` at 60% opacity. Pill radius. Horizontal padding: `sm` 12 · `md` 16 ·
`lg` 20.

**States.** Per §1.6.2. Loading keeps the label and swaps the icon for a
spinner so the button does not change width mid-press.

**Keyboard.** `Enter`/`Space`. A primary submit is reachable by `⌘Enter` from
anywhere in its form.

**Do not use** for navigation that could be a link — a button that navigates
breaks middle-click, copy-link and the back button. If it goes somewhere, it is
a link styled as a button.

### 2.2 Icon button

40px square (`sm` 32), icon 16px, `pill` radius, **`aria-label` mandatory**.
Tooltip on hover after 400ms carrying the same words as the label — not
different words, which is a common and confusing mistake.

**Do not use** three in a row where a menu would do; an overflow menu with
named items beats a row of guessable glyphs.

### 2.3 Input

**Anatomy.** Label (`caption`, 600) · control · hint or error (`caption`).
Label always visible — placeholders as labels fail the moment the field is
filled.

**Sizes.** `md` 40px (default) · `lg` 44px (mobile, primary forms) · `sm` 32px
(inline edit, filter values).

**Radius** `md`. **Padding** 14px horizontal. **Text** `body`.

**Variants.** Text · number (tabular, right-aligned) · money (currency selector
attached, live conversion beneath) · date · password (reveal toggle, always) ·
textarea (min 88px, resize-y) · search (leading icon, clear button when filled).

**States.** Rest · hover `line-strong` · focus (2px teal outline + border) ·
error (critical border, message replaces hint, `aria-invalid`) · disabled ·
read-only (no border, no background — reads as text, because it is).

**Error timing.** Validate on blur, never on keystroke. Clear the error on the
first keystroke of the correction. Telling somebody their email is invalid
while they are typing it is hostile.

**Inline edit** is the same component at `sm` with no chrome until hover:
hover shows a `line-subtle` border, click focuses and selects, blur or `Enter`
saves, `Esc` reverts. Save is optimistic with an undo toast. **This is the
default way records are edited in V2** (strategy §6, audit M-1).

### 2.4 Select and dropdown

Three distinct things, often conflated. Choosing wrongly is the most common
component error in an enterprise product.

| Component | When | Behaviour |
|---|---|---|
| **Select** | ≤7 fixed options | Native `<select>`, 40px, chevron |
| **Combo** | >7, or creatable | Search field, filtered list, "Add …" row |
| **Menu** | Actions, not values | Anchored popover, icons, destructive last |

**Combo is the workhorse.** Anatomy: trigger showing the selection or
placeholder · popover with search · grouped results · a create row when the
term matches nothing. **A combo may never be a dead end**: it either creates
what is missing or names where to go (audit C-1, principle 5).

**Menu** anchors to its trigger, flips above when there is no room below,
closes on scroll only when the anchor has actually moved, and — the bug worth
memorialising — closes on *click*, not `mousedown`, so the click lands on the
item rather than on nothing.

**Keyboard, all three.** `↑↓` move · `Enter` select · `Esc` close and restore
focus to the trigger · type-ahead jumps.

### 2.5 Table

The most important component in the product.

**Anatomy.** Header (36px, `micro` 600 uppercase-free, sortable columns are
buttons) · rows (44 comfortable / 36 compact) · optional selection column
(44px) · optional sticky first two columns · footer with pagination and count.

**Rules.**
- Numeric columns right-aligned and tabular. Text left. Never centred.
- Column widths are explicit; the identifying column takes the remainder.
- A cell truncates with a `title`; it never wraps. **Wrapping makes rows
  uneven, and uneven rows cannot be scanned** — this is why the ageing report's
  location column was fixed.
- Row hover `surface-subtle`; row selected adds a 2px accent left rail.
- The whole row is clickable *only* if it has one obvious destination.
- Empty, loading and error are the table's own states (§2.14), never a blank
  body.

**Below `sm` the table becomes cards.** Not a horizontal scroll: the figure
people came for must be visible without one. Already proven on inventory and
sales.

**Keyboard.** `j`/`k` or `↑↓` move · `Enter` open · `x` select · `Shift+↑↓`
extend · `⌘A` select all matching the filter, not the page (strategy §8.3).

### 2.6 Card

Container with `lg` radius, `card` elevation, `line-subtle` border.
Header (title `h3`, optional description `caption`, optional action) · body
(24px padding) · footer (wraps on narrow screens — a footer with text and a
button is wider than 320px).

**Do not use** a card to hold a table. The card's padding steals the width the
table needs; a full-bleed table with a header row above it is better and is
what V2 specifies.

### 2.7 Stat tile

Label (`caption`) · value (`h2`/`h3`, tabular) · caption with the comparison ·
optional sparkline · optional tone (default, accent, critical).

**A tile shows one number and what it is relative to.** A number with nothing
to compare it against is trivia. **Maximum four in a row**; five means the
screen has no priority.

### 2.8 Modal

Blocking. `overlay` elevation, `lg` radius, backdrop `navy-900/45`, 32px
padding, widths 480 / 640 / 800.

**Use for exactly two things:** a decision that cannot be undone, and a short
focused input that would lose context elsewhere.

**Do not use** for editing a record (that is inline), for a form of more than
about eight fields (that is a drawer or a page), or for anything that could be
a toast with an undo. A confirmation dialog trains people to click through it;
**undo is almost always the better design** and is the V2 default for
destructive list actions.

**Keyboard.** Focus moves to the first control on open; focus is trapped;
`Esc` closes; focus returns to the trigger. `⌘Enter` confirms.

### 2.9 Drawer

Right-anchored, 480 / 640 / 800 wide, full height, `drawer` elevation.

**Use for** creating something complex without losing the page behind it, and
for peeking at a record from a list.

**Do not use** for a two-field form (that is a modal or inline) or for the
primary view of an object (that is a page — a record deserves a URL).

**Renders in a portal.** A drawer inside a `backdrop-filter` ancestor is
positioned by that ancestor, which is how V1's mobile navigation ended up
trapped inside a 60px header.

### 2.10 Peek — new in V2

The strategy's answer to "the phone rings while you are doing something else."
A non-navigating overlay of a record, opened with `→` from any list or search
result. Read-mostly, with the two or three actions that matter. `Esc` returns
you exactly where you were, scroll position intact. `⌘Enter` promotes it to the
full record.

**Why it earns its place:** it removes the navigate-and-return round trip from
the single most frequent interruption in the product.

### 2.11 Alert and toast

**Alert** — inline, persistent, tied to a place. `md` radius, status tint at
12%, icon, title, body, optional action. Never dismissible if the condition is
still true.

**Toast** — transient, bottom-right, `raised`, 5s (8s with an action, 10s for
undo). Maximum three stacked. Politeness `polite`, or `assertive` for an error.

**Every destructive action produces a toast with an undo**, and undo is
available for 30 seconds. This is the mechanism that lets V2 remove
confirmation dialogs from bulk actions.

**Do not use** a toast for anything the user must act on — it disappears.

### 2.12 Badge, chip and status indicator

Three things with different jobs; V1 conflated the first two.

| Component | Job | Form |
|---|---|---|
| **Badge** | A count | 18px pill, `micro`, on a nav item or tab |
| **Chip** | A value, sometimes removable | 24px pill, `micro` 600, tinted, optional × |
| **Status** | A state in a lifecycle | Dot + label, status colour, never colour alone |

**Chips carry their own labels from a token map**, never from string
manipulation. `stage.replace('_',' ').toLowerCase()` appears three times in V1
and renders "payment pending" beside a properly cased sibling (audit L-1).
The label map is the single source; a chip may not derive text.

**A status indicator is a dot plus a word, always.** Ten per cent of the male
population cannot rely on the dot.

### 2.13 Tabs

For switching **views of the same object**, never for navigation between
different things.

Anatomy: 40px height, 2px bottom rail on the active tab, `small` 600, optional
badge. `←→` move, `Home`/`End` jump, panel is `role="tabpanel"` and labelled.

**Tabs are URL state.** A tab you cannot link to is a tab somebody will
screenshot instead.

**Do not use** more than five, and never a second row.

### 2.14 The three states every data surface must define

Not optional, and not an afterthought. **Any component that fetches has all
three**, and they are specified together so they cannot drift.

**Loading.** A skeleton with the *shape of the real content* — same row count,
same column widths, same card layout — with a 1.4s shimmer. Never a centred
spinner on a page: it says "something is happening" where a skeleton says
"here is what is coming". Skeletons appear after 120ms; below that, nothing,
because a flash of skeleton is worse than a brief blank. *(Audit H-9.)*

**Empty.** Icon · what would be here · why it matters · **one action that fills
it**. Distinguish *nothing yet* (a first-run state; offer creation) from
*nothing matching* (a filter state; offer to clear it). V1 conflated them and
told new users to widen filters they had never set.

**Error.** What failed, in plain words, and what to do. A retry that actually
retries. Never a stack trace, never "an error occurred", and never a blank
region where content should be.

### 2.15 Navigation

**Rail** — 224px, `surface-page`, five items (strategy §4.2), each 40px with a
16px icon, a label, and an optional badge. Active is `surface-subtle` with a
2px accent left rail. Collapsible to 64px icons with tooltips; the state
persists. Groups have `caption` 600 headings only when there is more than one.

**Active matching is specificity-based** — `/settings/users` lights Users, not
Settings and Users. Two lit items is a navigation that has given up.

**Top bar** — 60px: search trigger, currency, notifications, theme, account.
Backdrop blur, and every fixed-position descendant portalled to the body (§2.9).

**Mobile** — the rail becomes a sheet from a hamburger; the top bar keeps
search and notifications. The five items do not change: the same product, a
different container.

### 2.16 Command palette

The primary navigation surface (strategy §5), and therefore specified in
detail.

**Trigger** `⌘K` from anywhere including inside inputs. **Anatomy**: `overlay`
elevation, 640 wide, top-anchored at 15vh — centred vertically is wrong, the
list grows downward. Search input at 20px. Grouped results with a `micro`
heading per group. Each row: type icon · label · **one disambiguating fact** ·
optional shortcut.

**Behaviour.** Debounce 120ms. Results in under 100ms or the palette has
failed. `↑↓` move · `Enter` open · `⌘Enter` open in a new tab · `→` peek ·
`Esc` close. Empty query shows recents and top actions, never a blank panel.
`>` prefixes actions. Recency outranks relevance.

**A palette that returns nothing for a valid query trains users to stop using
it**, and takes every command you later add down with it.

### 2.17 Filter bar and view switcher

**Filter chip** — `field · operator · value`, 32px, removable, identical on
every list. Adding one is a menu of fields, then operators, then values.

**Filters are URL state.** A filtered list is a link you send a colleague; it
is also the mechanism by which saved views exist at all.

**View switcher** — a segmented control of saved views with a `+` to save the
current filter set. Ships with defaults per object; users create the rest. This
is what lets navigation be five items (strategy §8.1).

### 2.18 Bulk action bar

Appears at the bottom, `raised`, when a selection exists. Names the count and
the consequence — "Reassign 14 contacts to…" — not "Apply".

Destructive actions are permitted here **without a confirmation dialog**,
because every one is undoable for 30 seconds (§2.11). `Esc` clears the
selection. The bar never covers the last row: the list gains bottom padding
equal to the bar's height when it appears.

### 2.19 Chart components

Six forms, and choosing between them is a decision about the data's job, not
about variety.

| Job | Form |
|---|---|
| One headline number | Stat tile — **not a chart** |
| Magnitude across categories | Horizontal bar |
| Change over time | Line, or area for a single cumulative series |
| Composition of a whole | Stacked bar — never a pie beyond 3 slices, never a donut with a number in it |
| Progress through stages | Funnel |
| Relationship of two measures | Scatter |

Every chart: title, one y-axis, legend when ≥2 series, hover layer, table view,
recessive grid, marks per §1.6.4. **A chart with no interaction is an image**,
and an image cannot be interrogated.

### 2.20 Avatar, tooltip, pagination, breadcrumb

**Avatar** — initials on a hue derived from the id, so the same person is the
same colour everywhere. 24 / 32 / 48. Image when available, initials always as
the fallback.

**Tooltip** — 400ms delay, `inverse` surface, `caption`, max 240px, never
containing an action or anything essential. Touch devices do not get tooltips;
anything hidden behind one must exist elsewhere.

**Pagination** — count first ("Showing 1–25 of 312"), then controls, then page
size. The count is the useful part and reads first.

**Breadcrumb** — only where hierarchy is real (a record inside a list).
Two levels, current page not a link.

---

## 3. Icons

**Lucide**, 1.5px stroke, 16px in dense UI, 20px in navigation and empty
states, 24px never except in a hero empty state.

**One icon, one meaning, product-wide.** A registry maps concept → icon —
watch, contact, deal, task, money in, money out — and components reference the
concept. This is how you avoid three different icons for "customer" appearing
on three screens.

**Icons never appear alone in a primary action.** A glyph plus a label costs a
few pixels and removes a guess. The exceptions — close, overflow, chevron — are
the three universally learned glyphs, and each still carries an `aria-label`.

**Icons are decorative unless they are the only content.** `aria-hidden` beside
a label; labelled when standalone.

---

## 4. Motion

### 4.1 Principles

**Motion explains, or it does not happen.** Three legitimate jobs: showing
where something came from, directing attention to a change, and covering a
wait. Everything else is decoration and decoration is expensive at eight hours
a day.

**Fast in, slower out.** Things that appear should feel instant; things that
leave can take a moment. The reverse feels sluggish.

**Nothing moves that the user did not cause.** No autoplay, no attention-
seeking, no looping. The one exception is the skeleton shimmer, which is
covering a wait.

### 4.2 Durations and easing

| Token | Duration | Easing | Applied to |
|---|---|---|---|
| `instant` | 0ms | — | Selection, focus, checkbox |
| `fast` | 120ms | `ease-out` | Hover, colour, small fades |
| `base` | 200ms | `cubic-bezier(.2,0,0,1)` | Popover, menu, tooltip, toast |
| `slow` | 280ms | `cubic-bezier(.2,0,0,1)` | Drawer, modal, sheet |
| `deliberate` | 400ms | `cubic-bezier(.4,0,.2,1)` | Chart draw, page transition |

**Nothing exceeds 400ms.** A 600ms transition is perceptible as waiting, and a
user who is waiting for the interface is not working.

### 4.3 The animation inventory

Every animation in the product, exhaustively. **A component may not invent
one.**

| Animation | Spec |
|---|---|
| Fade in | opacity 0→1, `fast` |
| Slide up | translateY 8px→0 + fade, `base` — popovers, toasts |
| Slide in right | translateX 100%→0, `slow` — drawer |
| Scale in | scale .96→1 + fade, `base` — modal, palette |
| Shimmer | translateX −100%→100%, 1.4s linear, infinite — skeleton only |
| Row settle | background flash `teal-100`→transparent, 600ms — a row that just changed |
| Optimistic pending | opacity 1→.7, `fast` — an action in flight |
| Chart draw | marks scale from the baseline, `deliberate`, once on mount, never on update |
| Number roll | tabular digits, 400ms, **only on a hero figure**, never in a table |

**Reduced motion.** `prefers-reduced-motion: reduce` disables every transform
and every looping animation. Opacity transitions survive at 100ms because they
convey state rather than movement. This is a hard rule, not a nicety: motion
sensitivity is a genuine accessibility need and vestibular symptoms are real.

---

## 5. Interaction standards

**The keyboard model.** One set, product-wide, or it is worse than none.

| Key | Action |
|---|---|
| `⌘K` | Command palette |
| `/` | Focus the current list's search |
| `j` `k` / `↑↓` | Move within a list |
| `Enter` | Open |
| `→` | Peek |
| `x` | Select |
| `c` | Create, scoped to context |
| `e` | Edit the focused field |
| `⌘Enter` | Commit the current form |
| `Esc` | Close, cancel, clear selection — in that order of precedence |
| `?` | Shortcut reference |

**Optimism with a floor.** Every mutation applies immediately and reconciles
against the server. If it fails, the change reverts and a toast explains why.
The exceptions are money and identity — recording a sale, changing a password —
where the interface waits, because a sale that appears and then vanishes is
worse than a two-second wait.

**Undo over confirm.** Confirmation dialogs are reserved for the genuinely
irreversible: permanent deletion, voiding an invoice, revoking access.
Everything else is undoable for 30 seconds.

**URL is state.** Filters, tabs, open records, pagination and sort all live in
the URL. Nothing meaningful is component-only state. A view you cannot link to
is a view somebody will screenshot.

**Latency budget.** Interaction to painted result: p95 under 200ms.
Navigation to first meaningful paint: under 500ms. Search results: under 100ms.
Above 120ms, show a skeleton; above 1s, show progress; above 5s, it should not
have been synchronous.

**One primary action per view.** If two things compete, one of them is
secondary. If three do, the screen has no purpose.

---

## 6. Accessibility

**WCAG 2.2 AA is the floor**, and these are the rules that get broken in
practice.

**Contrast.** Body text ≥4.5:1, large text and UI boundaries ≥3:1, chart marks
≥3:1 against their surface — verified by computation, not by eye. Both chart
palettes in §1.6.4 were run through the validator and pass.

**Colour is never the only signal.** Status carries an icon and a word. Chart
series carry a legend and, where the CVD floor requires it, direct labels or
texture. Required fields carry an asterisk *and* a programmatic `required`.

**Focus is always visible.** One treatment, never removed, never `outline:
none` without a replacement in the same rule. Focus order follows the visual
order. Focus is trapped in modals and drawers and returned to the trigger on
close.

**Every control has an accessible name.** Icon buttons carry `aria-label`.
Inputs have real `<label>` elements. Tables have proper headers with scope.

**Live regions.** Toasts are `polite`; errors are `assertive`; a table that
updates in place announces the new count. Silence after an action is a screen
reader user not knowing whether it worked.

**Touch targets ≥44px** on touch devices, always, regardless of the visual
size of the control.

**Motion respects `prefers-reduced-motion`** (§4.3).

**Keyboard parity is absolute.** Every action reachable by mouse is reachable
by keyboard. Drag-and-drop always has a keyboard equivalent — on the pipeline
board that is the stage selector on every card, which exists precisely for
this reason.

**Zoom to 200%** without horizontal scrolling on any page.

---

## 7. Governance

**Tokens are the contract.** A component may reference only semantic tokens.
A hex in a component is a bug; a one-off value is a token that has not been
named yet or a decision that should be reversed.

**Adding to the system.** A new component needs: three real uses (two is a
coincidence), a specification with all five sections, both themes, all three
data states where it fetches, a keyboard model, and an accessibility pass.
Anything less is a one-off, and one-offs live in the feature that needs them,
not in the system.

**Deprecating.** Mark, migrate, remove. Two versions of a component in the
codebase at once is how a design system dies — V1's two sale forms with
different fields in a different order is exactly that failure, and it is how
one of them ended up with no way to attribute a sale.

**The automated check that keeps it honest.** V1 proved that a computed-style
audit finds drift screenshots cannot: it found eighteen button heights, off-
scale type and mismatched radii that nobody had noticed by eye. That audit runs
in CI against the token set and fails the build on a value that is not in this
document. **A design system without enforcement is a document, not a system.**

---

## Appendix — V1 → V2 at a glance

| Area | V1 | V2 | Why |
|---|---|---|---|
| Type sizes | 9 | 9 (`small` promoted to the dense default) | Legible 36px rows |
| Control heights | 44 / 36 | 44 / 40 / 32 | Density needs a scale |
| Ink levels | 2 | 3 (`content-muted` added) | Placeholders read as filled |
| Status colours | 3 | 4 (serious ≠ critical) | Overdue is not broken |
| Chart series | 2, unvalidated | 6 + sequential + diverging, **validated both modes** | An insights section needs a palette |
| Elevation in dark | Light shadows reused | Lightness + border | Shadows are invisible on dark |
| Skeletons | One component, one use | Every fetching surface | Perceived performance |
| Empty states | Inconsistent | Specified, and distinguishes *none yet* from *none matching* | Nothing is a dead end |
| Motion | Four ad-hoc keyframes | Nine, enumerated, with reduced-motion | Nothing invents its own |
| Confirmations | Dialogs | Undo, dialogs reserved for the irreversible | Dialogs train click-through |
| New | — | Peek · palette · filter chips · view switcher · bulk bar · inline edit | The strategy needs them |
