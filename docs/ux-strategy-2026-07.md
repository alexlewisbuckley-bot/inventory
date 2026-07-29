# Bluecroft — Product UX Strategy

**Date:** 29 July 2026
**Status:** Design strategy. No implementation. Supersedes the current interface.
**Input:** `docs/product-audit-2026-07.md`
**Reference standard:** Linear (speed, keyboard, restraint) · Attio (records, views, inline editing) · Stripe Dashboard (density with clarity) · Notion (one object, many views) · HubSpot (pipeline mechanics)

---

## 1. The premise

The audit found a product in two halves that had never been introduced. The
instinct is to build bridges between them. That is the wrong instinct, because
the halves are not two things.

**A luxury watch dealership has one object graph: a watch, a person, and money
moving between them.** The same firm sells you a Daytona on Tuesday and buys a
Submariner from you on Thursday. The same watch is a purchase, then stock, then
a sale, then — when it comes back in eight years — a purchase again. The
current product models this as Inventory over here and CRM over there, with
`customers.supplierId` bolted on as a plaster over the place where the fiction
breaks.

**The redesign is organised around motion, not entity type.** There are exactly
two motions in this business — you are either *acquiring* or *disposing* — and
almost everything else is the same object seen from a different side.

Three consequences follow, and everything in this document is downstream of
them:

1. **One contact object, not customers and suppliers.** A contact buys, sells,
   or both. (§4)
2. **One record anatomy for every object.** Learn it once, know the product.
   (§6)
3. **Lists are views over a filter, not bespoke pages.** "Unpriced stock",
   "Ageing", "Wanted", "Tasks due" stop being destinations and become saved
   views, which means users can make their own. (§8)

---

## 2. Who this is for, and what a good day looks like

Three people use this, and the current product is designed for the first.

**The owner** wants to know what capital is doing and what it is earning.
Opens the product two or three times a day, reads, rarely writes. Currently
well served.

**The salesperson** lives in it for eight hours. Answers the phone, records
what was said, chases offers, moves deals, closes them. Currently served by
screens they cannot write to. **This is the user the redesign is for**, because
they generate the data everyone else reads, and because a product the daily
user avoids has no data for the occasional user to read.

**The buyer/operations** books stock in, chases suppliers, handles paperwork
and despatch. Currently has an inventory form and nothing else — no purchase
workflow exists (§11).

A good day for the salesperson: they open the product once, work down a list,
and never navigate to find anything — the work comes to them, and everything
else is one keystroke away in search.

---

## 3. Design principles

Six principles. Each has a consequence, because a principle without one is
decoration.

**1. The keyboard is the primary interface; the mouse is the fallback.**
*Consequence:* every action has a shortcut, every list is arrow-navigable, and
no workflow requires precision pointing. Drag-and-drop is always a convenience
over a keyboard-reachable equivalent, never the only route.

**2. Search is navigation.**
*Consequence:* the navigation rail can be small, because nobody needs to
navigate to reach a record. Investment goes into search quality rather than
menu structure. (Resolves audit C-3.)

**3. Edit where you read.**
*Consequence:* no drawer to change one field. Forms exist for creation, not for
modification. (Resolves M-1.)

**4. Every list is the same list.**
*Consequence:* one filter grammar, one selection model, one bulk-action bar,
one saved-view mechanism, applied to stock, contacts, deals and tasks alike.
Learning any list teaches all of them. (Resolves H-4, M-8.)

**5. Nothing is a dead end.**
*Consequence:* every empty state offers the action that fills it; every picker
can create what is missing; every list can be exported. If a screen can be
reached, something can be done there. (Resolves C-1.)

**6. Show the reason, not just the result.**
*Consequence:* recommendations carry their evidence, figures carry their
derivation, and alerts carry what triggered them. Trust is the constraint on
adoption, and reasons are how trust is built.

---

## 4. Information architecture

### 4.1 The object model

Five first-class objects. Everything else is an attribute or an event.

| Object | Is | Replaces |
|---|---|---|
| **Watch** | A physical thing with a life history | Watch |
| **Contact** | A person or firm, with roles | Customer + Supplier |
| **Deal** | An intent to transact, in either direction | Deal + (new) purchase |
| **Activity** | Something that happened | Activity |
| **Task** | Something that should happen | Task |

**The contested decision: merging customers and suppliers into Contact.**

The argument against is that they are different — one has a budget, one has
payment terms. That difference is real but it is a *role*, not a *type*. A
contact carries one or both roles and the record shows the sections that apply:
a firm that both buys and sells gets both, on one page, which is the truth of
the relationship and is currently impossible to represent.

The evidence this is right is already in the codebase: `customers.supplierId`
was added to link the two halves of the same firm. That column is the design
apologising for the model.

What it buys us: one record anatomy, one search index, one activity timeline
per relationship, one place to see "we have bought £180k from them and sold
them £40k". What it costs: a migration, and the discipline to keep
role-specific fields out of the shared header.

**Deal becomes bidirectional.** A deal is an intent to transact — outbound
(we are selling) or inbound (we are buying). This is the single change that
creates the missing purchase workflow (§11) rather than building a second
system for it. A sourcing request becomes an inbound deal in the sourcing
stage; a purchase order is an inbound deal at commitment; booking stock in is
an inbound deal completing, exactly as recording a sale is an outbound deal
completing.

**Watch requests dissolve.** They are an inbound deal with no watch attached
yet, raised on behalf of a named contact. One less object, one less screen, and
the matching engine has more to work with because it can see every unfilled
demand in one query.

### 4.2 Navigation

From thirteen items to five, plus search. (Resolves H-3.)

```
⌘K  Search & command                    ← the primary interface

    Today            The agenda: what is due, waiting, overdue
    Stock            Every watch. Views: In stock · Unpriced · Ageing · Sold
    Deals            Board or list. Views: Mine · Selling · Buying · Closing
    Contacts         Every person and firm. Views: Customers · Trade · Quiet VIPs
    Insights         Reporting

    ⌥  Settings, Users, Help — in the account menu, not the rail
```

**Why five.** Every item removed is one fewer decision on every navigation.
Linear ships with roughly this many and is used by teams with far more surface
area than a watch dealership. The four saved filters that currently occupy
top-level slots ("Unpriced stock", "Ageing stock", "Wanted", "Tasks") become
views inside their parent, where their siblings live and where users can make
more of them.

**Why "Today" and not "Dashboard".** The name sets the contract. A dashboard is
a place to look at numbers; Today is a place to do work. (Resolves C-2.)

**Why "Insights" and not "Reports".** Reports are documents you export.
Insights are questions you ask. The section should behave like the latter.

**Badges** appear on Today (work due) and Deals (needs attention) only. A badge
on everything is a badge on nothing.

---

## 5. Search and command

Search is the most important surface in the product, and currently the least
invested in.

**One input, three jobs.** ⌘K opens a palette that does navigation, record
lookup and action dispatch, disambiguated by what you type — never by a mode
you have to select.

```
⌘K  gmt                    → records: watches, deals, contacts matching
⌘K  +44 7700              → the contact with that number (punctuation ignored)
⌘K  >log call             → actions, prefix-triggered
⌘K  INV-2026-114          → the sale, and its watch and buyer
```

**Ranking rules, in order:** exact identifier match (stock number, invoice,
reference) → records you touched recently → open work → everything else.
Recency matters more than relevance in a product where people return to the
same twenty records for a fortnight.

**Every result row shows its type and one disambiguating fact** — a watch shows
its serial, because two can share a reference; a contact shows their company; a
deal shows its stage. (This is the generalisation of the serial fix already
made to the watch picker.)

**Results are actionable without leaving.** `→` on a highlighted record opens a
peek — a non-navigating overlay of the record — so you can answer a question
mid-task and return with `Esc`. Linear's approach, and the correct one for a
product where the phone rings while you are doing something else.

**Scoped search** is the same component embedded in every list header, so the
grammar you learn in the palette works everywhere.

---

## 6. The record

Every object — watch, contact, deal — uses one anatomy. Learn it once.

```
┌────────────────────────────────────────────────────────────────┐
│  IDENTITY          Name, the two or three facts that identify  │
│                    it, status, and the primary action          │
├──────────────────────────────────────┬─────────────────────────┤
│  TIMELINE                            │  FACTS                  │
│  Everything that has happened,       │  Editable in place.     │
│  newest first, with the composer     │  Grouped, collapsible,  │
│  at the top.                         │  role-aware.            │
│                                      ├─────────────────────────┤
│                                      │  RELATED                │
│                                      │  The other objects this │
│                                      │  one touches, each with │
│                                      │  its own create action. │
└──────────────────────────────────────┴─────────────────────────┘
```

**Why timeline-left, facts-right.** The timeline is what you read; the facts
are what you consult. Reading gets the wide column and the reading position.

**Why the composer is at the top of the timeline.** Logging what just happened
is the most frequent write in the product. It should never be more than one
click from any record, and it should never push the history off the page.

**Facts are edited in place.** Click the value, type, blur to save. No drawer,
no modal, no save button. A change writes to the timeline as a system event, so
the record explains itself. (Resolves M-1.)

**Related is where creation happens.** "New deal" lives on the contact. "Log an
offer" lives on the deal. "Add a follow-up" lives on all three, pre-scoped to
what you are looking at. Creation in context is the fix for C-1 and it is
better than a create button on a list, because the association is already known
and does not have to be re-entered.

**Applied to each object:**

- **Watch** — identity: reference, serial, stock number, status, price.
  Timeline: purchase, movements, price changes, offers, sale. Facts: the
  physical thing, its cost, its asking price. Related: who might want it
  (with reasons), who has owned it, the deals against it, its photographs.
- **Contact** — identity: name, company, roles, tier, owner. Timeline: every
  conversation and transaction. Facts: contact details, plus a budget block if
  they buy and a terms block if they sell. Related: watches owned, deals, what
  they are looking for, stock that fits them, tasks.
- **Deal** — identity: title, stage, value, direction, counterparty. Timeline:
  the negotiation. Facts: probability, expected close, owner, source. Related:
  the watch or watches, offers, tasks, documents. (Resolves C-4.)

---

## 7. Journeys

The seven journeys that matter, with the interaction cost today and after.
"Interactions" counts clicks, keystroke sequences and navigations — the things
a user experiences as effort.

### 7.1 The phone rings — "who is this?"

*Today:* impossible. Search does not index contacts. **∞**

*After:* `⌘K`, type the last four digits, the contact peeks with their last
conversation, what they bought, and what they are waiting for. **2
interactions.**

Rationale: this is the highest-frequency, highest-value interaction in a
relationship business, and it currently has no support at all.

### 7.2 Take an enquiry

*Today:* no way to record what somebody wants. **∞**

*After:* from the contact record, `n` → "wants" → brand, reference, budget,
priority. Or, if they are new: `⌘K` → `>new enquiry` → type the name → the
contact is created inline and the enquiry attaches. **5 interactions.**

Rationale: the enquiry is the seed of every deal. Making it expensive to record
is the reason a pipeline is empty.

### 7.3 The morning routine

*Today:* open dashboard (stock figures), navigate to Tasks, read, navigate to
Pipeline, read, remember. **~8 interactions, and nothing is marked done.**

*After:* Today opens on the agenda. Overdue, then due, then waiting on others.
`j`/`k` to move, `x` to complete, `Enter` to open, `s` to snooze. Working
through eight follow-ups costs **8 keystrokes total.**

Rationale: this is the single most repeated sequence in the product. Every
interaction removed is multiplied by 250 working days.

### 7.4 Book a watch in

*Today:* Inventory → Add watch → a form of ~15 fields → save. **~20
interactions**, and the supplier relationship is a dropdown.

*After:* two paths.
- **From a purchase deal** (the normal case): the deal already knows the
  supplier, the price and the reference. Completing it books the watch in with
  those fields pre-filled. **3 interactions.**
- **Standing alone:** `⌘K` → `>add watch`, a five-field form (brand, reference,
  supplier, cost, location) with everything else deferred to the record.
  **~8 interactions.**

Rationale: a form that asks fifteen questions before it will accept anything
teaches people to enter stock later, in a batch, from a spreadsheet — which is
the behaviour this product was built to replace. Ask for what identifies the
watch; let the rest be filled in on the record where it can be edited in place.

### 7.5 Source a watch we do not have

*Today:* no workflow. The request table exists; nothing can write to it. **∞**

*After:* from the customer's enquiry, "source this" creates an inbound deal.
Pick suppliers to ask — the list is ranked by who has supplied that brand
before and how quickly they answered. Each response is logged against the deal.
Accepting a quote moves the deal to committed. **~6 interactions to ask three
suppliers.**

Rationale: this is the workflow that distinguishes a dealer from a shop, and it
is entirely absent (audit C-1, H-1).

### 7.6 Close a sale

*Today:* Inventory → find the row → status menu → mark as sold → dialog with
~12 fields → record. **~15 interactions**, and it was only recently possible to
attribute the sale to a customer at all.

*After:* from the deal, `w` (won). Everything the sale needs — customer, watch,
value — is already on the deal. Confirm the price and invoice number, and the
sale is recorded, the watch is marked sold, the customer's history is updated
and the delivery tasks are generated. **4 interactions.**

The route from inventory remains for walk-ins with no prior deal, and creates a
deal behind the scenes so the reporting is not full of sales that appeared from
nowhere.

Rationale: the sale is the completion of a deal, not a separate event.
Modelling it as separate is why the current sale form has to re-ask for
everything the deal already knew.

### 7.7 Price a watch

*Today:* inline price editing on the inventory table — genuinely good, keep it.
**2 interactions.**

*After:* unchanged, plus the suggestion of a price band derived from what
similar references have sold for, shown as a hint rather than a default.

---

## 8. The list system

One system, applied to every list. (Resolves H-4, M-8, and half of H-3.)

### 8.1 Views replace pages

A view is a saved filter, sort, column set and grouping, addressable by URL and
shareable. Ships with sensible defaults per object; users create their own.

This is what lets navigation shrink to five items: "Unpriced stock" is a view
of Stock, not a destination. "Quiet VIPs" is a view of Contacts. "Closing this
month" is a view of Deals. Users stop asking for new pages and make them.

### 8.2 One filter grammar

`field · operator · value`, chips left to right, and identical everywhere.
Filters compose with AND; a chip with multiple values is an OR within itself —
the model everyone already understands from Linear and Notion.

Filters are URL state. A filtered list is a link you can send to a colleague,
which is how internal tools spread inside a business.

### 8.3 Selection and bulk actions

`x` selects, `Shift+click` ranges, `⌘A` selects all matching the filter — not
just the loaded page, which is the distinction that makes bulk actions useful
on a list of 500.

The action bar names the count and the consequence: "Reassign 14 contacts to…".
Every bulk action is undoable for thirty seconds, because confirmation dialogs
train people to click through and undo does not.

Minimum verbs per object: **Stock** — move, reprice, tag, export, delete.
**Contacts** — assign owner, tag, change segment, export. **Deals** — assign,
move stage, close. **Tasks** — complete, reassign, reschedule.

### 8.4 Density and the table itself

Rows are 44px comfortable / 36px compact, honoured everywhere the setting is
offered (resolves M-9). Columns are user-configurable per view, resizable, and
the first two are frozen. Numeric columns are right-aligned and tabular.

---

## 9. Today

The home screen is an agenda, not a balance sheet. (Resolves C-2.)

```
Good morning, Alex
────────────────────────────────────────────────────────
⚠  3 overdue          Chase Dubai shipping · Marcus lot pricing · …
▸  5 due today        each row: what, who, why, and a way to do it
◷  2 waiting          offers sent, no reply — auto-surfaced after 3 days
────────────────────────────────────────────────────────
Pipeline    £127,100 open · £51,860 weighted · 2 closing this week
Stock       17 held · 7 unpriced · £170,372 invested
────────────────────────────────────────────────────────
Worth knowing
  · A 126610LV arrived that Henry Osei has been waiting for
  · Faisal Al Mansoori has not been contacted in 90 days
  · 3 exchange rates are over a month old
```

**Every row is actionable in place** — complete, snooze, open, log. Nothing on
this screen requires navigation to act on.

**"Worth knowing" is the automation surface.** Matching, quiet-VIP alerts,
stale rates and ageing stock all report here rather than each inventing its own
notification. One place to look means one habit to form.

**Role-aware default.** An owner's Today leads with capital and margin; a
salesperson's leads with their list. Same screen, different emphasis, chosen by
role rather than by a preference nobody sets.

---

## 10. CRM workflow

The contact record (§6) is the workspace. Around it:

**Capture is never a separate act.** Logging a call, adding a note, creating a
task and recording an offer all happen from the composer at the top of the
timeline, with the type chosen as you write rather than before you start.

**The pipeline is a view of deals, not a place deals live.** Board for shape,
list for work, table for bulk editing — the same objects, switched with one
control. The board's columns are the open stages only; won and lost are
outcomes, not places. Cards are draggable *and* stage-changeable by keyboard,
because drag alone excludes keyboard users and phones.

**Losing a deal asks why.** Kept from the current design — it is the one thing
lost deals are good for.

**Follow-ups are generated, not remembered.** An offer with no response after
three days, a deal that has not moved in fourteen, a VIP unspoken to for ninety
— each raises a task owned by somebody, visible on Today. The rule that
generated it is named on the task, so it can be argued with.

---

## 11. Purchase workflow — the missing half

The audit found no purchase workflow. This is the largest functional gap in the
product and the redesign creates it without a second system, by making deals
bidirectional (§4.1).

```
DEMAND              A customer wants something we do not hold
  ↓                 (an inbound deal, no watch attached)
SOURCING            Ask suppliers. Ranked by who supplies that brand,
  ↓                 how fast they answer, what they charged last time.
QUOTED              Responses land against the deal, comparable side by side
  ↓
COMMITTED           A quote accepted becomes a purchase commitment
  ↓                 (the thing a purchase order is)
IN TRANSIT          Expected, not yet held. Visible in stock as pending.
  ↓
BOOKED IN           The watch record is created from the deal, pre-filled.
                    The customer who wanted it is told automatically.
```

Every stage already has database support. What is missing is the workflow, and
modelling it as a deal means it inherits the board, the timeline, the tasks,
the reporting and the permissions rather than needing its own.

**Speculative buying** — stock bought without a customer waiting — is the same
flow with no demand step, entered at Sourcing.

**Supplier performance falls out of it for free:** response rate, response
time, quote competitiveness and delivery reliability are all derivable from
deal events, which is what H-1 asks for.

---

## 12. Inventory workflow

Largely sound; three changes.

**Intake is fast and deferred.** Five fields to create (§7.4), everything else
edited in place on the record. The current fifteen-field form is a barrier
disguised as thoroughness.

**Status is a consequence, not a control.** A watch is reserved because a deal
reached that stage; sold because a deal completed; in transit because a
purchase is on its way. Direct status editing stays as an escape hatch but is
demoted — when status is set by hand, the deals and the stock disagree, and the
stock is what gets trusted.

**The watch record answers commercial questions.** Who might want it and why
(already built, and good), who has owned it, what has been offered, how the
price has moved, what it has cost us in holding time. This is what turns an
inventory list into an asset register.

---

## 13. Sales workflow

The sale is the completion of a deal (§7.6). Beyond that:

**Money and the watch move independently.** Payment status and delivery status
are separate, both visible on the deal and in Today's "waiting" band, because
"paid but not collected" and "collected but not paid" are different problems
with different chases.

**Trade and retail everywhere.** The dimension exists; it should split every
revenue figure, every margin, and the pipeline itself. A trade deal at 6% and a
retail deal at 24% averaged together describe nothing.

**The invoice becomes a document.** Invoice numbers are captured and nothing is
printable (audit L-3). A sale should produce a PDF with the watch, the terms
and the warranty — the artefact the customer receives.

---

## 14. Reporting workflow

Three questions, three sections. Not a page of charts.

**"What is our capital doing?"** — deployed, by age, by brand, by location;
what is not moving and what it is costing to hold.

**"What is coming?"** — weighted forecast by expected close month, split by
trade and retail, with last quarter's forecast accuracy shown beside it,
because a forecast without a track record is a wish.

**"Where do deals die?"** — funnel by stage with drop-off, median dwell time
per stage, win rate by owner and by lead source. Every figure is derivable from
`deal_stage_events` today and none of it is asked. (Resolves H-7.)

**Every number is a link into the list that produced it.** A report you cannot
drill into is a report nobody trusts, and this single rule removes the need for
most of the export requests a reporting section otherwise accumulates.

---

## 15. Permissions

Three dimensions, not one. (Resolves H-2.)

**Role** — what kind of work you do: Owner, Manager, Sales, Operations,
Viewer. Note the addition of **Sales** (full CRM, no cost prices) and
**Operations** (stock and purchasing, no customer financials).

**Field sensitivity** — cost price, margin and supplier terms are marked
sensitive and masked for roles without the grant, in tables, records, exports
and search results alike. Masking that leaks through one surface is not
masking.

**Ownership scope** — whether you see everything or only what you own. Off by
default for a dealership of eight; available for one of forty.

**The rule that makes it coherent:** a capability the role lacks removes the
control entirely rather than disabling it. A disabled button is a question the
user cannot answer.

---

## 16. Responsive strategy

Not a scaled-down desktop. Two designs.

**Desktop (≥1024px)** is the working environment: dense lists, keyboard-first,
peek overlays, side-by-side record layout.

**Phone (<768px)** is the consultation environment. What people actually do on
a phone at a fair or in a car: look somebody up, read what was last said, log a
call, mark a task done, check whether we still have the watch. Everything else
can wait.

*Consequences:* the pipeline becomes a stage selector plus a single list, never
a horizontally scrolling board (resolves H-6). Records become tabbed — Timeline
first, Facts second — because a stacked record is a page of scrolling. Today
and search are the two screens that must be excellent; stock intake and bulk
editing are explicitly not.

**Tablet** follows the desktop layout with a collapsed rail.

---

## 17. What we are deliberately not building

Stated so the decisions are visible rather than accidental.

- **A customer portal.** This is an internal tool. Every hour spent on an
  external surface is an hour not spent on the eight-hour-a-day user.
- **Email sync.** Two-way sync is a product in itself. Log-what-you-sent, with
  `mailto:` and `wa.me` deep links pre-filled from the record, gets most of the
  value for a fraction of the cost. Revisit when someone asks twice.
- **Automated valuation.** Suggesting a price band from our own sales history
  is honest; scraping market prices is a data business we are not in.
- **A separate mobile app.** The consultation use case is served by a good
  responsive design.
- **Custom fields and custom objects.** Attio's flexibility is right for a CRM
  sold to everyone. This product knows what a watch is, and that knowledge is
  the advantage. Do not trade it for configurability nobody asked for.

---

## 18. Migration

The redesign is large; shipping it as a rewrite would be a mistake. Four
releases, each independently valuable.

**Release 1 — Make it a product.** Close the create gaps (C-1), build the deal
record (C-4), federate search (C-3), rebuild Today (C-2). Nothing is merged or
renamed yet. This is the release that makes the CRM real, and it is worth
shipping alone.

**Release 2 — One list system.** Views, filter grammar, selection and bulk
actions, applied everywhere. Navigation shrinks to five as the saved views
absorb the promoted filters. Users can now build their own screens.

**Release 3 — One graph.** Contacts merges customers and suppliers; deals
become bidirectional; the purchase workflow appears. The largest data
migration, taken alone, with the interface already stable around it.

**Release 4 — Depth.** Inline editing everywhere, pipeline reporting, field
permissions, invoice documents, the phone experience.

**What ships in every release:** the keyboard model grows, and no release is
allowed to leave a dead end behind it.

---

## 19. How we will know it worked

Design without a measure is decoration.

| Question | Measure | Today | Target |
|---|---|---|---|
| Is the CRM real? | Activities logged per salesperson per day | ~0 | 8+ |
| Is the pipeline trusted? | Deals with a stage change in the last 7 days | — | >80% |
| Is search the navigation? | Share of record opens that begin in ⌘K | ~0 | >50% |
| Is Today doing its job? | Tasks completed from Today vs elsewhere | n/a | >70% |
| Is intake fast enough? | Median time from arrival to booked in | unknown | <1 day |
| Is it fast? | p95 interaction to painted result | unknown | <200ms |

The first row is the one that matters. Every other number in this product is
downstream of whether the person on the phone writes down what was said.

---

## 20. The three decisions to argue with

Everything above is defensible; these three are genuinely contestable, and
should be argued before Release 3 rather than after.

1. **Merging customers and suppliers.** Right for a trade where firms sit on
   both sides; wrong if the two lists are truly disjoint in practice. Check the
   real book before committing to the migration.
2. **Making purchases into deals.** Elegant, and it inherits everything. The
   risk is that a purchase stage list that reads naturally to a salesperson
   reads as nonsense to a buyer. Prototype the board with the person who
   actually buys.
3. **Shrinking navigation to five.** Depends on search being excellent. If
   search ships mediocre, five items is a cage rather than a simplification.
   Do not shrink the rail until ⌘K has earned it.
