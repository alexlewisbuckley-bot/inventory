# Bluecroft — Product Audit

**Date:** 29 July 2026
**Panel:** Principal Product Designer · Staff UX Designer · SaaS Product Manager · Senior Front-End Architect · Senior Design Systems Engineer · QA Lead · Enterprise Software Consultant
**Benchmarks:** Linear · Attio · Stripe Dashboard · Notion · HubSpot
**Scope:** Audit only. No code was changed in producing this report.

---

## Method

Every route was walked signed in as an owner, at 1440px and 390px, with the
seeded book (14 customers, 7 open deals, 4 requests, 17 watches in stock).
Where a claim below is about behaviour rather than layout it was verified by
clicking, by reading the route graph, or by querying the database directly.

Twenty-three application routes exist. Four boundary files exist
(`loading`, `error`, `not-found` at the root; one `loading` for the whole
authenticated shell).

---

## Verdict

The inventory half of this product is genuinely good. It is opinionated, the
data model is honest, money is handled correctly, and the details that usually
rot — voided sales, partial unique indexes, currency at the boundary — have
been thought about. Against Linear and Stripe it holds its shape.

The CRM half is a **convincing demonstration, not a working product.** The
schema is right and the read screens are handsome, but you cannot create a
task, a watch request, an offer or a supplier enquiry anywhere in the
interface. Two of the four items in the "Sell" navigation group are read-only
views of data only the seed script can produce. A demo will not reveal this;
the second day of real use will.

The gap between the two halves is the story of this audit. Everything below is
a consequence of one of three root causes:

1. **Server capability shipped without interface.** Actions exist, wired to
   nothing.
2. **The two halves have not been introduced.** The dashboard, global search,
   reports, notifications and the audit trail all predate the CRM and none of
   them know it exists.
3. **Read-optimised, not work-optimised.** Screens are built to be looked at.
   Attio, Linear and HubSpot are built to be *worked in* — inline editing,
   bulk actions, keyboard throughput. Here almost every change requires a
   drawer.

**If one thing is fixed:** close the create gaps (C-1). It is the difference
between a demo and a product.

---

## Critical

### C-1 · Four workflows have a server but no interface

**Description.** `saveTaskAction`, `saveRequestAction`, `createOfferAction` and
`recordEnquiryAction` are implemented, validated, permission-checked — and
imported by no component. In the running application there is no way to:
create a follow-up task; register what a customer is looking for; record an
offer made; or log that a supplier was asked to source something. `/tasks` and
`/requests` are read-only. Their contents exist only because the seed script
wrote them, or because a deal was won and generated tasks automatically.

**Why it is a problem.** The navigation advertises four destinations under
"Sell"; two of them cannot be populated by a user. A salesperson who takes a
phone call and wants to note "he wants a Pepsi GMT, ring back Tuesday" has
nowhere to put either half of that sentence.

**Business impact.** The sourcing pipeline — the thing that differentiates a
dealer from a shop — cannot be operated. Watch requests drive the matching
engine, the "Wanted" board and the stock-arrival alerts; all three are inert
without a way in. Users will keep the real list on WhatsApp, and the
application becomes a place where you write down what already happened.

**UX impact.** Discovering that a screen is read-only takes about fifteen
seconds and permanently lowers trust in every other screen. "Which of these
buttons actually work?" is the question you never want asked.

**Severity: Critical.**

**Recommendation.** Not a button — three flows.
- **Task:** a create control on `/tasks`, plus "add a follow-up" on the
  customer, deal and watch records, pre-scoped to what you are looking at.
  Inline row-add (Linear's approach) beats a modal.
- **Request:** a create control on `/requests` and, more importantly, on the
  customer record — that is where the conversation happens. Reuse the watch
  form's brand/reference fields so it reads like the thing it describes.
- **Offer:** from the deal, the watch and the customer, with the amount
  defaulting to the asking price.
- **Enquiry:** from a request, picking a supplier — this closes the sourcing
  loop that already has a database table waiting for it.

---

### C-2 · The dashboard does not know the CRM exists

**Description.** The home screen is entirely stock-side: capital invested,
profit on stock, ageing, stock health, locations, recent sales. There is no
pipeline value, nothing due today, no overdue follow-up, no birthday, no hot
lead, no recent customer activity. `crmSummary()` — which returns all of
those — is written, tested and called by nothing.

**Why it is a problem.** The dashboard is the answer to "what should I do
today". For anybody whose job is selling, today's answer is a list of people to
ring, and this screen shows them stock levels instead.

**Business impact.** The follow-ups that generate revenue are invisible unless
somebody navigates to `/tasks` deliberately. Overdue work rots silently. The
sidebar shows a task badge; the home page does not act on it.

**UX impact.** The application appears to be two products sharing a login. It
also wastes the most valuable real estate in the product on figures that do not
change hour to hour.

**Severity: Critical.**

**Recommendation.** Rebuild the dashboard around *the day*, not *the balance
sheet*. Top band: what is due, what is overdue, what is waiting on you. Second
band: pipeline shape and value. Third: the stock attention queue that is there
now. Consider a role-aware default — an owner opens on capital, a salesperson
opens on their list — rather than one dashboard that is second-best for
everyone.

---

### C-3 · Global search finds watches and nothing else

**Description.** ⌘K searches `watches` on model, nickname and serial. It cannot
find a customer, a deal, a task, a supplier, an invoice number, an email
address or a phone number. The command list offers five static destinations,
none of them CRM.

**Why it is a problem.** In Attio and Linear, search *is* the navigation.
Here it is a watch-finder bolted to a shortcut key, so the only way to reach a
person is Customers → search → click, and the only way to reach a deal is to
find their record first.

**Business impact.** A phone rings with a number you half-recognise; there is
no way to answer "who is this and what do we owe them?" in one action. That is
the single most common CRM interaction in a dealership and the product does not
support it.

**UX impact.** Users learn the palette is unreliable and stop using it, which
also costs you every command you later add to it.

**Severity: Critical.**

**Recommendation.** Rewrite as a federated search over customers, deals,
watches, sales, tasks and suppliers, grouped by type with the type visible on
each row. Match phone numbers with punctuation stripped and email on substring.
Add actions to the palette ("Log a call", "New deal", "Add customer"). Rank
recency-first. This should be the single highest-throughput surface in the
product.

---

### C-4 · A deal has no record of its own

**Description.** The pipeline renders cards. A card links to the *customer*.
There is no `/pipeline/[id]`, so a deal has nowhere to hold its own timeline,
its offers, its tasks, its documents or its notes — all of which the schema
already supports (`activities.dealId`, `offers.dealId`, `tasks.dealId`,
`deal_stage_events`).

**Why it is a problem.** A deal is the unit of work for the sales side, and it
is the only major entity in the product without a detail view. Every negotiation
detail either goes on the customer's timeline — where it mixes with every other
deal — or nowhere.

**Business impact.** Stage history is recorded and unreadable. Nobody can
answer "what happened on this deal?" without reconstructing it from a customer
feed. Handover between salespeople is impossible.

**UX impact.** The board is a set of stubs. Users will treat cards as sticky
notes and keep the substance elsewhere.

**Severity: Critical.**

**Recommendation.** A deal record with the same anatomy as the customer record:
header with stage and value, timeline, offers, tasks, the watch, and the stage
history rendered as a horizontal progress with dwell time per stage. Reachable
by clicking the card body, with the customer link demoted to a chip.

---

## High

### H-1 · Suppliers were promised as first-class CRM entities and are not

**Description.** `supplier_contacts` exists in the database and is referenced by
nothing. The supplier screen is the same list it was before the CRM: no
timeline, no named contacts, no reliability, no response time, no open sourcing
requests, no profit generated. `activities.supplierId` is a column nobody
writes to from the interface.

**Why it is a problem.** Buying is half of this business. The purchasing side
has no equivalent of the customer record, so the relationship with the people
you buy from lives in the same place it always did — someone's phone.

**Business impact.** No supplier performance data means no negotiating
position, no view of who actually delivers, and no way to route a sourcing
request to the dealer most likely to find it.

**UX impact.** The asymmetry is conspicuous: customers get a rich record,
suppliers get a table row with an expander.

**Severity: High.**

**Recommendation.** Give suppliers the customer record's anatomy — contacts,
timeline, purchase history, open enquiries, profit generated, reliability
derived from enquiry outcomes. Link the dealer-who-is-also-a-customer through
the `supplierId` column already on `customers`.

---

### H-2 · The permission model has no salesperson

**Description.** Four roles. `VIEWER` has no CRM capability at all — not even
`customer:read`. `STAFF` gets the entire CRM including every financial figure,
every customer's lifetime value and margin on every watch. There is no role for
"sells watches, should not see what we paid".

**Why it is a problem.** Real dealerships run with floor staff, consignment
partners and part-timers. The only choices here are "sees nothing" and "sees
everything including cost price".

**Business impact.** Either you over-grant — and cost prices walk out the door
with the first leaver — or you under-grant and people work outside the system.
Enterprise buyers will ask about field-level permissions in the first call.

**UX impact.** A viewer sees a navigation bar with a Sell group they cannot
enter, or that silently disappears — neither reads as intentional.

**Severity: High.**

**Recommendation.** Add a sales role with CRM access and cost figures masked.
Longer term, separate *record* access from *field* access; margin and cost are
the two fields that need it. Also decide, explicitly, whether a salesperson
sees only their own customers — the `ownerId` column supports it and nothing
enforces it.

---

### H-3 · Navigation has grown to thirteen items across four groups

**Description.** Dashboard, Inventory, Sales | Pipeline, Customers, Wanted,
Tasks | Unpriced stock, Ageing stock | Suppliers, Locations, Reports |
Settings, Users, Help. "Needs attention" is two saved filters promoted to
top-level navigation. "Wanted" is a coined term for watch requests.

**Why it is a problem.** The groups are not a model of the business — they are
the order things were built in. Inventory and Sales sit above the group called
Sell, which contains Pipeline. Two saved searches occupy the same visual weight
as the entire customer book.

**Business impact.** Onboarding cost. Every new employee has to be told which
of the thirteen is the one they live in.

**UX impact.** Linear ships with roughly five persistent destinations and
pushes everything else into search and views. Thirteen items with badges on
four of them is a lot of colour competing for attention.

**Severity: High.**

**Recommendation.** Restructure around the two motions the business actually
has: **Buy** (stock, suppliers, sourcing) and **Sell** (pipeline, customers,
sales). Demote "Unpriced" and "Ageing" to saved views inside Inventory where
their siblings live. Rename "Wanted" to "Requests" or fold it into the customer
record entirely. Target seven top-level items.

---

### H-4 · No bulk actions anywhere in the CRM

**Description.** Inventory supports multi-select with move and delete.
Customers, deals and tasks support none — no select, no bulk assign, no bulk
tag, no bulk status change, no export.

**Why it is a problem.** Every real CRM task at scale is a bulk task:
reassigning a departing salesperson's accounts, tagging everyone who bought a
Daytona, marking a batch of follow-ups done.

**Business impact.** Administration that should take a minute takes an
afternoon, so it does not happen, and the data degrades.

**UX impact.** The inconsistency is itself a defect — the same table component
behaves differently on two screens for no reason a user can infer.

**Severity: High.**

**Recommendation.** Lift the inventory selection pattern into the shared table
and apply it to customers, deals and tasks. Minimum verbs: assign owner, add
tag, change status, export.

---

### H-5 · Tags are in the database and nowhere in the product

**Description.** `tags` and `entity_tags` are migrated and unused. There is no
way to create, apply, filter by or see a tag.

**Why it is a problem.** Tagging is how every CRM handles the categories the
schema did not anticipate — "Baselworld 2026", "pays late", "wants steel
sports". Without it, that knowledge goes in the notes field where it cannot be
queried.

**Business impact.** No segmentation. No "email everyone who collects Patek".
The marketing consent field is therefore also unusable in practice.

**UX impact.** Users invent conventions inside free-text notes, which then
cannot be searched consistently.

**Severity: High.**

**Recommendation.** Ship tags on customers and suppliers with a picker on the
record, a filter on the list, and tag-based saved views. This is a small build
against an existing schema and unlocks segmentation.

---

### H-6 · The pipeline is unusable on a phone

**Description.** At 390px the board renders four full-width stat cards, a
search box and a filter before the first column — roughly 900px of chrome
above any deal. The board itself is then a horizontally scrolling row of
286px columns.

**Why it is a problem.** The pipeline is the screen most likely to be consulted
away from a desk, at a fair or in a car, and it is the worst mobile experience
in the product.

**Business impact.** Deals do not get updated when they change, which is the
moment the information is worth capturing. Stale pipeline is worse than no
pipeline because it is trusted.

**UX impact.** Horizontal scrolling inside a vertical scroll is the classic
mobile trap; users lose their place and give up.

**Severity: High.**

**Recommendation.** Below `md`, drop the board entirely: a stage selector
across the top and a single vertical list of that stage's deals, with the stats
collapsed to one summary line. Card tap opens the deal record. This is the
pattern HubSpot mobile uses and it works.

---

### H-7 · Reports ignore the pipeline

**Description.** Reports cover capital deployed, revenue, profit, sell-through,
capital by location, supplier performance, ageing and the new trade/retail
split. Nothing about deals: no conversion by stage, no cycle time, no win rate
over time, no performance by salesperson, no forecast.

**Why it is a problem.** `deal_stage_events` records every transition with a
timestamp precisely so these questions can be answered, and nothing asks them.

**Business impact.** No answer to "where do deals die?" — the single most
valuable question a sales pipeline can be asked. No forecast means no planning.

**UX impact.** Reports feels like a stock report with a customer section
appended.

**Severity: High.**

**Recommendation.** Add a pipeline section: funnel by stage with drop-off,
median dwell time per stage, win rate by owner and by lead source, and a
weighted forecast by expected close month. Split every existing revenue figure
by trade and retail, now that the dimension exists.

---

### H-8 · Duplicate customers are prevented only by exact email match

**Description.** Creation is blocked when the email string matches exactly.
Nothing catches "Faisal Al Mansoori" and "F. Al-Mansoori" with different
addresses, or the same person entered from the sell form and again from the
deal form. There is no merge.

**Why it is a problem.** The product now has four doors into customer creation
(customer form, sell form, deal picker, sale attribution). Multiple doors
without dedupe is how a book fills with near-duplicates.

**Business impact.** Lifetime value, purchase history and the recommendation
engine all silently understate when a person exists twice. The engine's output
is only as good as the identity resolution beneath it.

**UX impact.** Users see two of somebody they know is one person and lose faith
in the numbers.

**Severity: High.**

**Recommendation.** Fuzzy match on name plus normalised phone at the point of
creation — "did you mean…?" — and a merge tool that reassigns sales,
activities, deals and requests to a survivor.

---

### H-9 · No loading feedback on the heaviest screens

**Description.** One `loading.tsx` covers the entire authenticated shell. There
is no per-route loading state and no skeletons on the CRM screens. The customer
record fans out to eight queries including a taste profile and a stock match;
the watch record now runs a scoring pass over the whole customer book.

**Why it is a problem.** Navigation feels like nothing happened, then the page
replaces itself. Perceived performance is a function of feedback, not
milliseconds.

**Business impact.** Slowness is the most common reason internal tools get
abandoned, and perceived slowness counts.

**UX impact.** No sense of progress, and no protection against double-clicking
a link.

**Severity: High.**

**Recommendation.** Per-route `loading.tsx` with skeletons matching each page's
actual layout — the `Skeleton` primitives already exist and are used by the
inventory table only. Stream the expensive panels with Suspense so identity
renders immediately and suggestions arrive after.

---

## Medium

### M-1 · Nothing in the CRM can be edited in place

Every change to a customer opens a drawer with thirty fields. Changing a tier,
an owner or a phone number costs a modal, a scan and a save. Attio's entire
premise is that a CRM is a spreadsheet you can also read; inventory already has
inline price editing, so the pattern exists in this codebase and was not
carried across. **Recommendation:** inline edit on the record's key fields and
on list cells for owner, tier and segment.

### M-2 · The timeline cannot be filtered, and files cannot be attached

Calls, emails, notes, stage changes and system events share one feed with no
way to show only conversations. The brief called for attachments; there is no
upload on an activity, though the image pipeline exists for watches.
**Recommendation:** type filter chips, and attachments reusing the existing
image service.

### M-3 · Communications are retyped by hand

Logging a call means typing what was said. There is no email integration, no
WhatsApp, no click-to-send, no templates — despite WhatsApp being the recorded
preferred channel for several seeded customers. **Recommendation:** treat this
as a roadmap item, not a gap to paper over. In the interim, `mailto:` and
`wa.me` links pre-filled from the record, and one-click "log what I just sent".

### M-4 · A deal holds exactly one watch

`deals.watchId` is singular. The seeded "Trade lot — three sports models" is a
deal pointing at one watch, which is a lie the data model tells. Trade deals are
frequently multi-item. **Recommendation:** a `deal_items` join, with the deal
value derived from its lines.

### M-5 · Customer budgets are GBP-only

The application handles four currencies carefully everywhere except here: a
Dubai customer's budget is stored and shown in GBP. **Recommendation:** carry
currency on the budget as `MoneyField` does elsewhere.

### M-6 · Requests cannot be progressed from the interface

`setRequestStatusAction` exists and is unused: a request cannot be cancelled,
marked fulfilled or reopened. Combined with C-1 the entire request lifecycle is
read-only. **Recommendation:** status control on the request card, and
fulfilment linked to the sale that satisfied it.

### M-7 · The audit trail does not list CRM entity types

The entity filter offers Watch, Sale, User, Supplier, Location, AppSetting.
Customer, Deal and Request are recorded but unfilterable. **Recommendation:**
derive the filter list from the data rather than hard-coding it.

### M-8 · Empty states are inconsistent

Some screens use the `EmptyState` primitive with an icon, explanation and
action; the CRM record cards use a sentence of grey prose with no action. The
richest empty state in the product is on Sales, which is also the least visited
when empty. **Recommendation:** every empty state gets one action, and the ones
a new customer sees first deserve the most care.

### M-9 · Density preference applies to one table

The profile offers Comfortable or Compact. It reaches the shared `Table`
component and therefore inventory and sales, but the CRM cards, timeline and
board ignore it. A preference that works in some places is worse than one that
works nowhere. **Recommendation:** honour it in the CRM surfaces or scope the
setting honestly to "tables".

### M-10 · No keyboard model beyond ⌘K

No J/K list navigation, no `c` to create, no `e` to edit, no escape-to-close
consistency across drawers versus modals. The help page documents shortcuts
that are mostly navigation. **Recommendation:** a small, consistent set —
create, search, navigate, close — applied identically on every list.

---

## Low

- **L-1 · Stage labels are derived by string manipulation.** `stage.replace('_',' ').toLowerCase()` appears in three components while `DEAL_STAGE_LABELS` exists. "Payment pending" renders as "payment pending" beside a properly cased chip.
- **L-2 · "Wanted" is a coined term.** No dealer says it. "Requests" or "Sourcing" is what the domain calls it.
- **L-3 · Invoice numbers exist but nothing is printable.** No PDF, no invoice view, despite `invoiceNo`, warranty months and delivery status all being captured.
- **L-4 · Sales ledger does not show the customer link.** It shows the name string, so a linked sale and an unlinked one look identical, and the segment is invisible on the screen where revenue is read.
- **L-5 · The taste profile has no confidence signal.** One purchase produces "Spends in this price band" with the same weight as ten.
- **L-6 · Deal probability can silently disagree with its stage.** Editing it by hand detaches it from the stage default with no indication it has been overridden.
- **L-7 · No "recently viewed".** Every navigation starts from a list, on a product where people return to the same twenty records.

---

## Prioritised plan

**Now — makes it a product rather than a demo**
1. C-1 Create flows for task, request, offer, enquiry
2. C-4 The deal record
3. C-3 Federated global search
4. C-2 Rebuild the dashboard around the day

**Next — makes it usable at scale**
5. H-1 Supplier as a first-class record
6. H-4 Bulk actions
7. H-5 Tags and segments
8. H-9 Loading states and streaming
9. H-6 Mobile pipeline

**Then — makes it defensible**
10. H-7 Pipeline reporting and forecast
11. H-2 Sales role and field-level permissions
12. H-8 Dedupe and merge
13. H-3 Navigation restructure
14. M-1 Inline editing

**Later**
15. M-3 Communications integration
16. M-4 Multi-item deals
17. Everything remaining in Medium and Low

---

## What is genuinely good, and should not be touched

Said plainly, because an audit that only criticises is not usable as a plan.

- **The money model.** Integer minor units, GBP as base, currency captured at
  the point of agreement and converted only for display. Most products this
  size get this wrong and never recover.
- **The voided-sale semantics.** A sale that did not happen is kept, excluded
  from every figure, and lets the watch be sold again. The partial unique
  indexes that make it work are the mark of someone who has been burned before.
- **The audit trail and the activity timeline as separate concerns.** One is
  compliance, one is relationship. Merging them would have been the obvious
  and wrong decision.
- **The design system.** Eight type sizes, five radii, two shadows, one focus
  treatment, 44px form controls and 36px chrome. It is more disciplined than
  most Series-B products.
- **The recommendation engine's reasons.** Showing why somebody is on the list
  is the difference between a feature people trust and one they ignore.
- **The commit history.** Each change explains the failure it prevents. That is
  worth more to the next engineer than any document.
