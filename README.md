# Bluecroft Stock

Internal inventory management for luxury watch stock. Replaces the shared
"ChronoHub" spreadsheet with a multi-user system that tracks every watch from
purchase through location transfers to sale, with a full audit trail.

---

## Quick start

```bash
npm install
cp .env.example .env      # then set AUTH_SECRET to 32+ random characters
npm run db:seed           # applies migrations and loads reference + demo data
npm run dev               # http://localhost:3000
```

Seeded sign-ins (all use the password `Bluecroft2026!`):

| Email                     | Role    | Sees                                          |
| ------------------------- | ------- | --------------------------------------------- |
| `alex@bluecroft.co.uk`    | Owner   | Everything, including users and settings      |
| `sarah@bluecroft.co.uk`   | Manager | Stock, sales, suppliers, imports, audit trail  |
| `omar@bluecroft.co.uk`    | Staff   | Add/edit stock, move watches, record sales     |
| `priya@bluecroft.co.uk`   | Viewer  | Read-only                                      |

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit tests (Vitest) |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run db:seed` | Migrate, then seed idempotently |
| `npm run db:reset` | Drop the local database and re-seed |

---

## Architecture

```
src/
  app/                 Next.js App Router
    (auth)/            Unauthenticated routes (login)
    (app)/             Authenticated shell — every route here has a session
    actions/           Server actions; the only mutation entry points
    api/               Route handlers (search, export, health, locations)
  components/
    ui/                Design-system primitives (the Figma component library)
    layout/            Shell: header, navigation, command palette
    inventory/         Feature components for the stock module
  server/
    auth/              Password hashing, sessions, rate limiting
    db/                Schema, client, migrations, seed
    repositories/      Read models and queries
    services/          Business logic and transactions
  lib/                 Pure, dependency-free helpers (money, dates, permissions)
  hooks/               Reusable client hooks
```

**The rule that keeps this maintainable:** UI never touches the database.
Pages and components call server actions, actions assert a capability and
validate input, services own business rules and transactions, repositories own
queries. Anything in `lib/` is pure and unit-testable.

### Key decisions

**Money is integer minor units.** Every monetary column is an `INTEGER` of
pence or cents. Floating-point arithmetic on currency accumulates error, and
this data feeds profit reporting. `src/lib/money.ts` is the only sanctioned
conversion path. This is covered by tests.

**Two currencies, stored not derived.** The spreadsheet held GBP and USD side
by side because the FX rate at purchase matters. Both are stored, along with
the rate applied, so a historic purchase never silently re-prices when today's
rate moves.

**Optimistic concurrency on watches.** Each watch carries a `version`. Edit
forms submit the version they loaded; a mismatch is rejected with a message
telling the user to reload, rather than silently overwriting a colleague.

**Soft deletes.** Watches, suppliers, locations and users carry `deletedAt`.
Deleted stock stays queryable for audit and can be restored. Sold watches
cannot be deleted at all — they are part of the sales record.

**Capabilities, not role checks.** Code asks `can(role, 'watch:delete')`, never
`role === 'MANAGER'`. Adding a role is a data change in
`src/lib/permissions.ts` and nothing else moves.

**Audit inside the transaction.** `recordAudit` is called within the same
transaction as the change it describes, so the log can never disagree with the
data.

See [`docs/adr/`](docs/adr) for the data-layer decision record.

---

## Data model

```
users ──< sessions
      ──< user_preferences
      ──< audit_logs, notifications

brands ──< watches >── suppliers
                   >── locations
watches ──< stock_movements >── locations
        ──< watch_photos
        ──1 sales
```

Money columns are minor units; timestamps are unix-millis integers. Indexes
cover every filter and sort the inventory list exposes, plus the
`(status, location_id)` pair the dashboard aggregates on.

Migrations are plain SQL in `src/server/db/migrations`, applied in filename
order and recorded in a `_migrations` ledger. Forward-only: to change the
schema, add a new file.

---

## Security

- **Passwords**: scrypt (N=32768, r=8, p=1) from the Node standard library,
  with constant-time comparison. No third-party dependency in the auth path.
- **Sessions**: signed JWT in an httpOnly, SameSite=Lax cookie, backed by a
  database row so sessions stay individually revocable. Changing a password
  bumps a token version that retires every session issued before it.
- **Rate limiting**: per-email and per-IP on sign-in; per-user on mutations,
  imports and exports.
- **Login responses** are deliberately identical for unknown emails and wrong
  passwords, including comparable response time, so the endpoint cannot be used
  to enumerate accounts.
- **Authorisation** is enforced server-side in every action and route handler.
  Client-side capability flags only decide what to render.
- Middleware checks cookie *presence* to redirect anonymous traffic cheaply; it
  is a UX optimisation, never the security boundary.

## Accessibility

Targets WCAG 2.1 AA. Overlays trap focus, restore it on close and respond to
Escape; tables use `aria-sort`; toasts announce through `aria-live`; forms wire
`aria-describedby` and `aria-invalid` centrally in `Field`; a skip link opens
the tab order; `prefers-reduced-motion` disables animation.

## Deployment

Set `DATABASE_URL`, a strong `AUTH_SECRET`, and `NODE_ENV=production`, then
`npm run build && npm start`. `/api/health` reports process and database
liveness for load-balancer probes.

Moving to Postgres means changing the driver in `src/server/db/client.ts` and
translating the migration SQL — the query layer, services and UI are unchanged.
