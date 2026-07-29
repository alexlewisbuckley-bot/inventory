# CRM build — plan of record

The brief: stop being an inventory application with contacts bolted on. Become one
platform where a watch, the person who wants it, the dealer it came from and the money
it made are the same story told from different angles.

This file is the plan of record. It is committed so that any session can pick the work
up mid-flight. Tick items off as they land.

## Principles

1. **No new island.** Every CRM object attaches to something that already exists — a
   watch, a supplier, a sale, a user. A customer page that cannot show you the watches
   is a contact list, not a CRM.
2. **One timeline primitive.** Calls, emails, WhatsApp, meetings, notes, offers, stage
   changes and system events are all *activities* against one or more entities. Building
   six separate feeds is how CRMs become unusable.
3. **The pipeline is the sale, earlier.** A deal that completes becomes the existing
   `sales` row. There is no second source of truth for revenue.
4. **Preserve what works.** Money stays in integer minor units with GBP as base. RBAC
   stays capability-based. Migrations stay forward-only SQL with the `_migrations`
   ledger. Lists stay URL-driven so a view can be shared.

## Phase 1 — Schema (migration `0006_crm.sql`)

- [x] `customers` — name, email, phone, country, preferred channel, VIP tier, budget
      range (minor units), birthday, lead source, assigned user, marketing consent,
      risk notes, first/last contact timestamps, soft delete
- [x] `customer_brands` — favourite brands (join to `brands`)
- [x] `tags` + `entity_tags` — one tag vocabulary across customers and suppliers
- [x] `supplier_contacts` — named people at a supplier, one flagged primary
- [x] `deals` — customer, optional watch, stage, value, probability, expected close,
      owner, source, lost reason, closed timestamps
- [x] `deal_stage_events` — every stage transition, for cycle-time and conversion
- [x] `offers` — deal, watch, amount + currency, status, sent/responded timestamps
- [x] `watch_requests` — customer, brand, reference, dial, bracelet, condition, budget
      ceiling, target date, priority, status
- [x] `activities` — type, direction, subject, body, occurred at, actor, and nullable
      foreign keys to customer / supplier / watch / deal / request
- [x] `tasks` — title, notes, due date, assignee, status, completed at, recurrence, and
      the same nullable entity links
- [x] `sales.customer_id`, `sales.deal_id`, plus commission, deposit, balance,
      payment status, delivery and warranty columns (keeping `customer_name` as the
      fallback for rows recorded before customers existed)

Enums live in `src/lib/enums.ts` beside the existing ones. New capabilities
(`customer:*`, `deal:*`, `task:*`, `activity:*`) go in `src/lib/permissions.ts`.

## Phase 2 — Server

- [x] `customer-repository` / `deal-repository` / `activity-repository` /
      `task-repository` — list, filter, paginate in the same shape as watches
- [x] `crm-service` — create and update with audit records, stage transitions that write
      `deal_stage_events`, offer responses, request matching
- [x] `matching` — a watch entering stock finds open requests it satisfies; a request
      finds watches already held
- [x] Server actions in `src/app/actions/crm.ts`

## Phase 3 — Interface

- [x] `/customers` list + `/customers/[id]` record: header, timeline, watches owned,
      open deals, requests, tasks, notes
- [x] `/pipeline` board: columns by stage, drag to move, value per column
- [x] `/tasks` — today, overdue, upcoming, by assignee
- [x] `/requests` — the sourcing board, with inventory matches inline
- [ ] Supplier record gains contacts, activity, purchase history, reliability
- [ ] Watch record gains: interested customers, offers, enquiries, sourcing, timeline
- [ ] Dashboard gains pipeline value, tasks due, overdue follow-ups, birthdays
- [ ] Global search covers customers, deals, tasks, phone numbers and email addresses
- [x] Navigation groups: Sell (Pipeline, Customers, Requests, Tasks) alongside Stock

## Phase 4 — Automation

- [ ] Task generated when a deal is won (delivery, invoice, warranty)
- [ ] Follow-up reminder when a deal sits in a stage past its threshold
- [ ] Birthday and purchase-anniversary reminders
- [ ] Alert when a watch arrives that matches an open request
- [ ] Low-contact alert for a VIP not spoken to in N days

## Phase 5 — QA

Re-run the existing harnesses against every new screen: `stress.mjs` (adversarial
input, four viewports, third-party requests), `tests/journeys` (clicked workflows),
`audit.mjs` (computed-style drift), plus new journeys for the pipeline board, the
customer record and request matching.

## Where this got to

Phases 1 and 2 are complete, and phase 3 has the four new destinations —
customers, the customer record, the pipeline board, tasks and the wanted board
— live in navigation with working counts.

The sell flow is integrated: recording a sale attributes it to a customer,
closes the deal it came from and writes both on to the timeline. One sale form
now serves the inventory row and the watch record.

Still outstanding, in the order worth doing them:

1. **The watch record's CRM panel.** `interestInWatch` and `ownershipHistory`
   are written and tested but not yet rendered: a watch page should show who
   wants it, what has been offered, and who has owned it.
2. **The deal record.** Cards link to the customer; a deal of its own with its
   timeline, offers and tasks is the missing half of the pipeline.
3. **Supplier CRM.** `supplier_contacts` exists; the supplier record needs the
   contacts, its activity feed and the sourcing history.
4. **Dashboard widgets.** `crmSummary` returns pipeline value, tasks due,
   overdue follow-ups, birthdays and quiet VIPs; nothing renders it yet.
5. **Global search.** The palette should reach customers, deals and tasks, and
   match on phone numbers and email addresses.
6. **Automation.** Task generation on a won deal and the offer chase are done;
   birthdays, anniversaries and lead ageing are not.
7. **Journeys.** The clicked suite needs: create a customer, log a call, drag a
   deal across the board, lose one with a reason, and match a request.
