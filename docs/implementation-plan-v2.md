# Bluecroft V2 — Implementation Plan

**Date:** 29 July 2026
**Status:** Roadmap. No code until this is agreed.
**Inputs:** `product-audit-2026-07.md` · `ux-strategy-2026-07.md` · `design-system-v2.md` · `screen-designs-v2.md`

---

## 1. How this plan avoids breaking the product

Four rules govern every epic. They are the reason the ordering below is not
simply "most valuable first".

**Additive before subtractive.** New tokens, new components and new routes land
*alongside* the old ones and change nothing visually. Only once a replacement
is proven does the old one get removed. This is why the design-system epic is
split in two (E1 and E7) with six epics between them — the split is the single
most important decision in this plan.

**Expand · migrate · contract, for data.** A schema change adds columns and
backfills, deploys code that writes both and reads new, then drops the old — in
three separate releases, never one. The Contacts merge (E8) is the only epic
where this matters and it is the reason that epic is late.

**New screens live at new routes until they win.** `/deals` is built while
`/pipeline` still works. Navigation switches when the replacement is better,
not when it is finished. Rollback is a navigation change, not a revert.

**Every epic ends green.** Typecheck, unit tests, journeys and the adversarial
sweep all pass before an epic is called done. An epic that leaves the suite red
is not done, it is abandoned.

**Complexity scale.** `S` a focused sitting · `M` a day of concentrated work ·
`L` several days · `XL` a week or more, and a candidate for splitting.

---

## 2. Epics

### E0 · Safety net and CI

**Objectives.** Make the existing behaviour testable before changing any of it.
Nothing else in this plan is safe without it.

Three harnesses proved their worth during the V1 QA cycles and are all
currently gitignored — they were lost twice when the sandbox reset. They become
part of the repository and part of CI.

**Files affected**
- `tests/journeys/index.mjs` — extend from 14 to ~30 clicked journeys covering
  every workflow that must survive the redesign
- `tests/harness/stress.mjs`, `tests/harness/audit.mjs`, `tests/harness/shots.mjs`
  — moved in from the repo root, un-ignored
- `.github/workflows/ci.yml` — new
- `package.json` — `test:all`, `test:visual`, `test:tokens`
- `.gitignore` — remove the harness entries

**Dependencies.** None. This is the first thing.

**Components required.** None.

**Complexity.** M

**Testing requirements.** The suite *is* the deliverable. Coverage floor before
E1 begins: every route renders for every role; every create/edit/delete round
trip; sign-in, sign-out, permission denial; the four viewports; the money
paths (record a sale, void it, resell the watch).

**Risks**
- *Journeys encode current bugs as expected behaviour.* Write assertions
  against the user-visible outcome, never the DOM structure — structure is what
  the redesign changes.
- *CI needs Postgres and Chromium.* Service container plus the pinned browser;
  budget half a day for the pipeline itself.

---

### E1 · Design tokens V2 — additive only

**Objectives.** Every V2 token available in the codebase. **Zero visual
change.** New sizes, the third ink level, the fourth status colour, the chart
palettes, motion tokens and the density multiplier all exist; nothing consumes
them yet.

**Files affected**
- `tailwind.config.ts` — control heights `sm 32 / md 40 / lg 44`, motion
  durations and easings, chart palette entries
- `src/styles/globals.css` — `--c-content-muted`, `--c-state-serious`, six
  categorical steps per theme, sequential and diverging ramps, dark elevation
  borders
- `src/lib/tokens.ts` — **new.** The single export of chart palettes, status
  ordering and the label maps that stop components deriving text from enum
  strings
- `tests/tokens.test.ts` — **new**

**Dependencies.** E0.

**Components required.** None yet.

**Complexity.** S

**Testing requirements.** A token test asserting the palettes match the
validated hex values exactly, and that every semantic token resolves in both
themes. The computed-style audit runs and records a *baseline* — it does not
yet fail the build.

**Risks**
- *Tailwind's default `sm`/`md` sizes shifting under existing components.* Add
  the new scale under distinct names first; rename in E7.
- *Someone consumes a token early and ships a visual change.* The epic is
  defined as zero-diff in screenshots; the visual harness proves it.

---

### E2 · Create flows — closing the C-1 gap

**Objectives.** Make the CRM writable. Task, want, offer and supplier enquiry
all creatable from the interface. The highest business value in this plan and
close to the lowest technical risk: the server already does all four.

**Files affected**
- `src/components/crm/TaskComposer.tsx`, `WantComposer.tsx`,
  `OfferComposer.tsx`, `EnquiryComposer.tsx` — **new**
- `src/components/crm/TaskList.tsx` — gains a create row
- `src/app/(app)/requests/page.tsx` — gains create and status controls
- `src/app/(app)/customers/[id]/page.tsx` — create actions on each related panel
- `src/app/actions/crm.ts` — no new actions; wire `saveTaskAction`,
  `saveRequestAction`, `createOfferAction`, `recordEnquiryAction`,
  `setRequestStatusAction`
- `tests/journeys/index.mjs` — four new journeys

**Dependencies.** E0. Nothing else — deliberately.

**Components required.** Inline create row (a `sm` input that becomes a row),
the existing `Drawer` for the longer want form.

**Complexity.** M

**Testing requirements.** A journey per flow that creates through the UI and
verifies the record exists *and appears where it should* — a task created on a
contact must appear on `/tasks`. Permission tests: a Viewer sees no create
control at all, rather than a disabled one.

**Risks**
- *Low.* The actions are validated and permission-checked already.
- *Composers drift into four different shapes.* One `Composer` primitive with
  four configurations, agreed before the first is written.

---

### E3 · Deal record

**Objectives.** The object with no detail view gets one: timeline, offers,
tasks, watch, live margin, and the stage rail that renders history already
being recorded.

**Files affected**
- `src/app/(app)/pipeline/[id]/page.tsx` — **new** (moves to `/deals/[id]` in E7)
- `src/components/crm/DealHeader.tsx`, `StageRail.tsx`, `DealFacts.tsx` — **new**
- `src/server/repositories/crm-repository.ts` — `getDealContext`,
  `stageHistory`
- `src/components/crm/PipelineBoard.tsx` — card body links to the record
- `src/components/crm/Timeline.tsx` — accepts a deal scope (already does)

**Dependencies.** E2 (the record's panels create things).

**Components required.** Stage rail (new), reuses Timeline, Card, Chip, facts
list.

**Complexity.** M

**Testing requirements.** Journey: open a deal from the board, log a call, add
an offer, move a stage, confirm the rail updates. Unit: dwell-time calculation
from stage events, including a deal that skipped stages and one that moved
backwards.

**Risks**
- *Stage rail maths on unusual histories* — backwards moves, same-day
  transitions, deals created directly into a late stage. Unit-test each.

---

### E4 · Search and peek

**Objectives.** Federated search over six object types with phone and email
matching, actions in the palette, and the peek overlay. The screen that makes a
five-item navigation possible.

**Files affected**
- `src/app/api/search/route.ts` — rewritten: union across watches, contacts,
  deals, sales, tasks, suppliers
- `src/server/repositories/search-repository.ts` — **new**
- `src/components/layout/CommandPalette.tsx` — rewritten
- `src/components/ui/Peek.tsx` — **new**
- `src/components/**/*Row.tsx` — `→` opens peek from any list
- Migration `0009_search_indexes.sql` — trigram indexes on the searched
  columns, plus a normalised phone expression index

**Dependencies.** E0. Independent of E1–E3.

**Components required.** Peek overlay, palette result rows, grouped list.

**Complexity.** L

**Testing requirements.** Latency assertion — results under 100ms against a
seeded book of 5,000 contacts and 10,000 watches, which the seed must be able
to generate. Journeys for each query shape: name, partial phone with
punctuation, invoice number, stock number, `>action`. Peek returns focus and
scroll position exactly.

**Risks**
- *Search quality is the whole epic.* A palette that misses is abandoned, and
  it takes the rail reduction down with it. Do not ship the five-item rail
  until this is measurably good (strategy §20.3).
- *`ILIKE '%term%'` will not hold at scale.* Trigram indexes from the start;
  measure at 10× the current data, not at seed size.

---

### E5 · Today

**Objectives.** Replace the dashboard with the agenda. Three action bands, two
tiles, one automation surface, role-aware ordering.

**Files affected**
- `src/app/(app)/today/page.tsx` — **new**; `(app)/page.tsx` redirects when the
  flag flips
- `src/components/today/Agenda.tsx`, `AgendaRow.tsx`, `WorthKnowing.tsx` — **new**
- `src/server/services/crm-service.ts` — `crmSummary` finally consumed;
  add `agendaFor(userId)`
- `src/server/services/insights-service.ts` — **new**, for the two tiles
- `src/components/dashboard/*` — untouched until E7, then deleted

**Dependencies.** E2 (completing and snoozing tasks).

**Components required.** Agenda row with inline complete/snooze, tile, the
"worth knowing" list.

**Complexity.** L

**Testing requirements.** Journey: complete a task from Today and confirm it
leaves the band and the sidebar badge drops. Optimistic completion reverts on a
server error. Empty state when the agenda is genuinely clear. Role fixtures for
owner, sales and operations orderings.

**Risks**
- *The agenda query fans out.* Budget one round trip; measure with 5,000 tasks.
- *"Worth knowing" becomes a dumping ground.* Each rule needs an owner, a
  threshold and a way to dismiss it, agreed before the epic starts.

---

### E6 · The list system

**Objectives.** One views, filters, selection and bulk-action system, applied
to every list. The infrastructure that lets navigation shrink.

**Files affected**
- `src/components/ui/DataList/` — **new**: `View.tsx`, `FilterBar.tsx`,
  `FilterChip.tsx`, `BulkBar.tsx`, `ColumnMenu.tsx`
- `src/hooks/useListQuery.ts` — extended to the full grammar
- `src/hooks/useSelection.ts`, `useSavedViews.ts` — **new**
- `src/lib/filters.ts` — **new**: the field/operator/value model per object
- Migration `0010_saved_views.sql` — per-user saved views
- `src/components/inventory/FilterBar.tsx`, `SavedViews.tsx`,
  `ColumnPicker.tsx`, `BulkActionBar.tsx` — replaced
- `src/components/crm/CustomerTable.tsx`, `sales/SalesTable.tsx` — adopt it

**Dependencies.** E1 (tokens).

**Components required.** The five above, plus selection-aware `Table`.

**Complexity.** XL — **split it.** E6a inventory only (it has the most mature
pattern to generalise from); E6b every other list; E6c saved views persisted
per user.

**Testing requirements.** Filter grammar unit tests including URL round trip
and hostile input. Journey: build a filter, save it as a view, reload, share
the URL to a second session. `⌘A` selects everything matching the filter and
not merely the page — assert against a filtered set larger than one page.

**Risks**
- *Generalising too early.* Build it for inventory, use it for sales, then
  extract. A shared abstraction written before its second consumer is a guess.
- *Bulk actions without undo are dangerous.* Undo (E7's toast work) must land
  with, or before, destructive bulk verbs.

---

### E7 · Component migration to V2

**Objectives.** The visual change. Every component moves onto the V2 tokens,
the new control scale, the four status colours, the motion inventory, the three
data states. This is where the product starts looking like V2.

**Files affected.** Every file in `src/components/ui/` (21 components), then
every consumer. Plus:
- `src/components/ui/Skeleton.tsx` — a skeleton per data surface
- `src/app/(app)/**/loading.tsx` — per-route, replacing one shell-wide file
- `src/components/ui/Toast.tsx` — undo support
- Route renames: `/pipeline → /deals`, `/customers → /contacts`,
  `/reports → /insights`, with permanent redirects from the old paths

**Dependencies.** E1, and ideally E2–E5 shipped so the new screens are migrated
once rather than built twice.

**Components required.** All of them.

**Complexity.** XL — **split by component family.** E7a buttons, inputs,
selects. E7b table, card, list. E7c overlays: modal, drawer, peek, toast,
palette. E7d states: skeletons, empty, error. E7e navigation and route renames.

**Testing requirements.** The visual harness is the primary gate: capture every
route at four viewports in both themes before and after each sub-epic, and
review the diffs deliberately — a design change looks identical to a regression
to a machine, so this is a human check with machine assistance.
The computed-style audit now **fails the build** on any value outside the token
set. Full journey suite green after every sub-epic.

**Risks**
- *This is the epic that breaks things.* Every screen changes at once, and V1's
  QA cycles found real bugs in exactly this territory — an 18-height button
  scale, a focus ring painting a white halo, a mobile nav trapped inside a
  blurred header, a `sr-only` element pushing the whole app to a third width.
  Mitigations: one component family at a time, visual diff on every one, and a
  rule that no sub-epic merges with a failing sweep.
- *Route renames break bookmarks and the journey suite.* Permanent redirects
  from every old path, kept indefinitely; update journeys in the same commit.
- *Density multiplier regresses spacing in unexpected places.* It changes
  vertical padding only, and only inside components that opt in.

---

### E8 · Contacts — the merge

**Objectives.** Customers and suppliers become one object with roles. The
largest data migration in the plan, and the one with no easy rollback.

**Files affected**
- Migrations `0011`–`0013`, deliberately three releases:
  - `0011` add `contacts` with a role bitmask, backfill from `customers` and
    `suppliers`, keep both tables writable
  - `0012` repoint `watches.supplier_id`, `sales.customer_id`,
    `deals.customer_id`, `activities.*`, `tasks.*` at `contacts`
  - `0013` drop the old tables — **a separate release, weeks later**
- `src/server/repositories/contact-repository.ts` — **new**, absorbing
  `crm-repository`'s customer half and `reference-service`'s supplier half
- `src/app/(app)/contacts/` — list and record
- `src/components/crm/CustomerTable.tsx`, `reference/SupplierManager.tsx` — deleted
- Every consumer of `customerId` — roughly 20 files

**Dependencies.** E6 (the list system) and E7 (the record anatomy). Doing this
before the UI is stable means migrating twice.

**Components required.** Role chips, role-aware fact groups, the merged record.

**Complexity.** XL

**Testing requirements.** A migration test on a copy of production: row counts
reconcile, no orphaned foreign keys, a firm that is both a customer and a
supplier collapses to one contact with two roles and keeps both histories.
A **reversibility rehearsal** — restore a pre-migration snapshot and replay —
before `0011` runs anywhere real.

**Risks**
- *Highest-risk epic in the plan.* A bad merge silently loses relationship
  history, and lifetime value goes quietly wrong rather than loudly.
- *Duplicate detection during the merge.* The same firm may exist as a customer
  and a supplier with different names. Match on email, then normalised phone,
  then flag the rest for a human — never auto-merge on name similarity.
- *The strategy itself flags this as contestable* (§20.1). Confirm against the
  real book before `0011`. If the two lists turn out disjoint in practice, drop
  the epic and keep the `supplierId` link.

---

### E8 — resolution, recorded 30 July 2026

**Dropped, by this epic's own criterion.** The plan said: *"Confirm against
the real book before `0011`. If the two lists turn out disjoint in practice,
drop the epic and keep the `supplierId` link."* Measured: 11 customers and 7
suppliers, **zero** overlap by email, zero by normalised phone, zero
`supplier_id` links in use. The lists are disjoint in practice. The merge
would have spent the plan's highest-risk migration buying a unification the
data says nobody needs — so the Contact object is not built, the
`supplier_id` link remains for the day a counterparty genuinely appears on
both sides, and E9 proceeds against suppliers as they stand. Re-measure
before ever reviving this: the criterion is written above.

---

### E9 · Sourcing

**Objectives.** The purchase workflow. Deals become bidirectional; watch
requests become inbound deals; the enquiry loop, commitment, transit and
book-in all work.

**Files affected**
- Migration `0014_deal_direction.sql` — `direction`, inbound stages, backfill
  every existing deal to outbound, migrate `watch_requests` into deals
- `src/server/services/sourcing-service.ts` — **new**
- `src/app/(app)/deals/` — the Buying view and the purchase record
- `src/components/sourcing/SupplierAsk.tsx`, `QuoteList.tsx` — **new**
- `src/app/(app)/requests/` — deleted, redirects to the Buying view
- `src/server/services/watch-service.ts` — intake from a completed purchase

**Dependencies.** E3 (the deal record it extends), E8 (suppliers as contacts).

**Components required.** The ask panel, quote comparison, the already-in-stock
check.

**Complexity.** L

**Testing requirements.** End-to-end journey: a want becomes a purchase, three
suppliers are asked, one quotes, the quote is accepted, the watch is booked in,
and the customer's want is marked fulfilled with a notification. Assert
supplier response metrics derive correctly from the events.

**Risks**
- *A stage list that reads naturally to a salesperson may read as nonsense to a
  buyer* (strategy §20.2). Prototype the board with whoever actually buys,
  before the migration.
- *`watch_requests` migration.* Requests carry data deals do not; add the
  columns before migrating rather than losing dial and bracelet preferences.

### E9 — resolution, recorded 30 July 2026

Shipped at reduced scope, chosen deliberately: the loop is closed without the
deals remodel. The Wanted board stays; what was missing was the downhill half
of the workflow, and that is what was built. Each quoted enquiry on a want's
card now carries "Book it in →", which opens intake pre-filled from the
request and the quote (`sourcingPrefill`): customer named in the header, brand,
model, supplier, quoted price as the purchase price, budget as the opening
sale estimate — all editable, because a prefill is a head start, not a
decision. After the watch is created, `completeSourcing` settles the paperwork
outside the intake transaction: the want is FULFILLED, the timeline records the
sourcing on customer, request and watch, the request's owner is notified
(unless they did the booking-in themselves), and an offer task exists with an
`autoKey` so a double book-in cannot create a second instruction. The
`0014_deal_direction.sql` migration, inbound deal stages, and the deletion of
`/requests` were not done — the bidirectional-deals remodel remains open as a
future epic if buying volume ever justifies a pipeline of its own. The plan's
end-to-end journey exists as written (want → enquiry → quote → accept →
book-in → fulfilled + task), minus the three-supplier metrics, which belong to
the remodel.

---

### E10 · Insights

**Objectives.** Three questions, drill-through on every figure, the chart
system, trade and retail split throughout.

**Files affected**
- `src/app/(app)/insights/page.tsx` — replaces `/reports`
- `src/components/charts/` — **new**: `Bar`, `Line`, `Funnel`, `StatTile`,
  `ChartFrame`, `TableView`
- `src/server/repositories/insights-repository.ts` — **new**: funnel, dwell
  time, win rate, forecast accuracy
- `src/components/reports/MonthlyChart.tsx` — deleted

**Dependencies.** E1 (validated palettes), E3 (stage events).

**Components required.** Six chart components, each with hover, legend and a
keyboard-reachable table view.

**Complexity.** L

**Testing requirements.** Palette validator in CI against the exact hex values.
Every chart has a table view reachable by keyboard. Funnel maths unit-tested
against hand-computed fixtures including deals that skipped stages. Every
figure links to a filtered list that returns the same number — a drill-through
that disagrees with its headline is worse than no drill-through.

**Risks**
- *Charts invented per screen.* The chart components are the contract; a page
  may not render an SVG directly.
- *Forecast accuracy needs history.* Show it only once there are two closed
  quarters; before that the section says so.

---

### E11 · Permissions

**Objectives.** Sales and Operations roles; cost and margin as maskable fields;
optional ownership scoping.

**Files affected**
- `src/lib/permissions.ts` — two roles, field-sensitivity map
- `src/server/auth/session.ts` — `canSeeField`
- Migration `0015_role_expansion.sql`
- Every repository returning money — masking at the query boundary, not in the
  component
- `src/app/(app)/settings/people/page.tsx`

**Dependencies.** E7 (so masked fields render consistently).

**Components required.** A masked-value component that reads identically
everywhere.

**Complexity.** L

**Testing requirements.** A matrix test: every role × every route × every
sensitive field, asserting the value is absent from the **payload**, not merely
hidden in the DOM. Exports and search results included — masking that leaks
through one surface is not masking. Journeys signed in as each new role.

**Risks**
- *Masking in the component leaks through the API.* Mask at the query
  boundary; the matrix test asserts against the network response.
- *Role changes mid-session.* Bump the token version so permissions cannot be
  stale.

---

### E12 · Mobile

**Objectives.** The consultation experience: Today, search, contact and deal
records, task completion. Explicitly not intake or bulk editing.

**Files affected**
- `src/components/layout/MobileNav.tsx` → bottom bar
- `src/components/crm/PipelineBoard.tsx` — stage selector below `md`
- Record pages — tabbed below `lg`
- Every list — card treatment (inventory and sales already have one)

**Dependencies.** E7.

**Complexity.** M

**Testing requirements.** The viewport sweep at 320, 390 and 768 with the
sideways-scroll assertion — the check that caught the board scrolling the whole
document behind its own scroller. Touch targets ≥44px asserted by computed
style, not by eye.

**Risks**
- *Mobile treated as a follow-up.* The rule from the screen designs: a mobile
  treatment ships **with** its screen. This epic exists to catch what the
  earlier ones missed, not to be their dumping ground.

---

### E13 · Settings, people, notifications

**Objectives.** Settings into the account menu as tabs; People with the new
roles; notifications demoted to "what happened while I was away".

**Files affected**
- `src/app/(app)/settings/**` — restructured to tabs
- `src/components/settings/*` — migrated to V2
- `src/app/(app)/notifications/page.tsx` — grouped by day, dot-not-tint
- `src/components/layout/AppSidebar.tsx` — five items, Settings out of the rail

**Dependencies.** E7, E11.

**Complexity.** M

**Risks**
- *Moving Settings out of the rail hides it.* Keep `⌘K → settings` working and
  measure whether anyone struggles.

---

## 3. Recommended order

```
E0  Safety net            ██                         ← nothing starts before this
E1  Tokens (additive)      ██
E2  Create flows            ████                     ← ships value in week one
E3  Deal record                ████
E4  Search & peek              ██████
E5  Today                          ████
E6a List system (inventory)          ████
E6b List system (the rest)               ████
E7a Buttons, inputs                          ███
E7b Table, card, list                           ███
E7c Overlays                                       ███
E7d States                                            ██
E7e Navigation + renames                                ██
E10 Insights                                              ████
E9  Sourcing                                                  ████
E8  Contacts merge                                                █████
E11 Permissions                                                      ████
E12 Mobile                                                              ███
E13 Settings, people, notifications                                       ███
```

**Why this order and not another.**

*E2 before everything visual.* Closing the create gaps needs no new
infrastructure and turns a demo into a product. Shipping it first means the
next four months of refactoring happen on a product people are using, which is
the only reliable source of feedback.

*E4 before E7.* Search must be excellent before navigation shrinks. Ship the
rail reduction in E7e only once the palette has earned it (strategy §20.3).

*E7 late, and split five ways.* The visual migration is the highest-regression
work in the plan. Doing it after the new screens exist means each screen is
migrated once. Doing it in five sub-epics means a bad diff is one component
family, not the whole product.

*E8 last of the structural work.* The Contacts merge is irreversible in
practice. It should happen against a stable interface, with the list system and
record anatomy already proven, and only after the assumption behind it is
checked against the real book.

*E10 before E9.* Insights depends only on data that already exists; Sourcing
depends on E8. Taking Insights first keeps value shipping while the merge is
being rehearsed.

---

## 4. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | E7 regresses layout across the product | High | High | Five sub-epics, visual diff per family, computed-style audit failing the build |
| R2 | Contacts merge loses relationship history | Medium | Critical | Three-release expand/migrate/contract, rehearsed restore, three-week gap before the drop |
| R3 | Search ships mediocre and the rail shrinks anyway | Medium | High | Rail reduction gated on a measured search-quality bar, not on E4 being "done" |
| R4 | The plan outruns the users | Medium | Medium | E2 ships in week one; every epic after it is independently valuable |
| R5 | Journeys encode current bugs as expectations | Medium | Medium | Assert user-visible outcomes, never DOM structure |
| R6 | Performance degrades as screens fan out | Medium | Medium | Latency budget in CI: p95 under 200ms, search under 100ms, measured at 10× seed data |
| R7 | Two versions of a component live side by side | High | Medium | Every sub-epic ends with the old one deleted; a lingering duplicate is a failed epic |
| R8 | Permission masking leaks through an API | Low | Critical | Mask at the query boundary; matrix test asserts against payloads |
| R9 | Mobile deferred until E12 and never caught up | Medium | Medium | Mobile treatment ships with each screen; E12 is a sweep, not the plan |
| R10 | Sandbox or environment loss mid-epic | Medium | Low | Everything committed and pushed at the end of each working session |

---

## 5. Definition of done, per epic

An epic is done when **all** of these hold. Anything less is in progress.

1. `tsc --noEmit` clean
2. Unit suite green, with new tests for new logic
3. Journey suite green, extended to cover the epic's workflows
4. Adversarial sweep green: nonsense input, four viewports, no sideways scroll,
   no third-party requests, focus visible on every tab stop
5. Computed-style audit green against the token set (from E7 onward, blocking)
6. Both themes checked at 1440 and 390
7. Every new data surface has empty, loading and error states
8. Every new interactive element is keyboard-reachable and labelled
9. The component or route it replaces is **deleted**, not left beside it
10. Committed and pushed, with a message explaining the failure it prevents

---

## 6. What would make me stop and rethink

Stated in advance, because a plan that cannot be falsified is a wish.

- **E2 ships and activity logging does not rise.** If the salespeople still do
  not log calls once it is possible, the problem was never the missing button
  and the rest of this plan is aimed at the wrong thing.
- **Search cannot get under 100ms at realistic scale.** The five-item rail
  depends on it; without it the IA reverts to something closer to V1's.
- **The real book shows customers and suppliers barely overlap.** Then E8 is
  cost without benefit — keep two objects and the existing link.
- **E7a lands and the visual diff is unreadable.** If one component family
  produces hundreds of unreviewable diffs, the migration needs to be per-screen
  rather than per-component, and the plan changes shape.
