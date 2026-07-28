# Architecture

## The layering rule

UI never touches the database. Every request travels the same path:

```
page / component
      │  (no data access, no business rules)
      ▼
server action  ──── asserts a capability, validates input with Zod
      │
      ▼
service        ──── business rules, transactions, audit
      │
      ▼
repository     ──── queries and read models
      │
      ▼
Drizzle → node:sqlite
```

Anything in `src/lib/` is pure: no database import, no framework import. That
is what makes it unit-testable, reusable on the client, and safe to import from
anywhere.

**A rule learned the hard way:** if a test needs to import it, it must not
transitively import `node:sqlite`. Vitest cannot resolve the builtin, so a pure
helper buried in a service takes its whole dependency graph down with it. Money,
dates, permissions, diffing, CSV and the settings registry all live in `lib/`
for this reason.

## Request lifecycle

1. **Middleware** checks only that a session cookie is *present*, redirecting
   anonymous traffic cheaply at the edge. It is a UX optimisation and never the
   authorisation boundary — cryptographic verification needs Node APIs.
2. **The `(app)` layout** resolves the real session server-side. Every route in
   that group is therefore guaranteed a user.
3. **Server actions** call `requireCapability(...)`, which throws 401 or 403
   before any work happens.
4. **Services** open a transaction, apply the rule, and write the audit entry
   inside it, so the log can never disagree with the data.

## Money

Stored as integer minor units everywhere. `src/lib/money.ts` is the only
sanctioned conversion path, and its behaviour is pinned by tests.

Both GBP and USD are stored, along with the FX rate applied at the time. The
spreadsheet did this because the rate at purchase matters — deriving USD on
read would silently re-price historic purchases whenever the rate moved.

Margin is stored in basis points (integer, ×100) rather than a float, so
`8.43%` survives a round trip through the database exactly.

## Concurrency

Watches carry a `version`. Edit forms submit the version they loaded; a
mismatch is rejected with a message telling the user to reload, rather than
silently overwriting a colleague's change.

`withTransaction` in `src/server/db/client.ts` drives SQLite transactions
directly, because Drizzle's `sqlite-proxy` adapter cannot express them. Nested
calls join the outer transaction — SQLite has no nested `BEGIN`.

## Deletion

Soft deletes (`deletedAt`) on watches, suppliers, locations and users.
Repositories filter them out; the audit trail keeps them. Two hard rules:

- Sold watches can never be deleted — they are part of the sales record.
- Suppliers and locations cannot be deleted while stock references them. The
  UI explains why and offers deactivation instead.

## Permissions

Capability-based. Code asks `can(role, 'watch:delete')`, never
`role === 'MANAGER'`. Roles map to capability sets in `src/lib/permissions.ts`
and are strictly additive up the ladder — a test asserts this, so a future edit
cannot accidentally grant staff something managers lack.

Two further guards live in the user service: a user may only assign roles at or
below their own level, and the system refuses any change that would leave it
without an active owner.

## Known limitations

- **Photo upload** is designed but not implemented; the drawer shows an honest
  empty state rather than a fake control.
- **Email notifications** are stored as a preference but no mail transport is
  wired up. In-app notifications work.
- **Rate limiting** is in-process, which suits a single instance. Scaling
  horizontally means swapping the store in `src/server/auth/rate-limit.ts`;
  no call site changes.
- **`node:sqlite`** is experimental in Node 22 and prints a warning. Moving to
  Postgres is a driver swap plus SQL translation; the query layer is unchanged.
