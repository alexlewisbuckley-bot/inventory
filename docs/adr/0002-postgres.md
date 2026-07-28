# ADR 0002 — Replace SQLite with Postgres

**Status:** Accepted · **Date:** 2026-07-28 · **Supersedes the storage half of ADR 0001**

## Context

ADR 0001 chose Drizzle over `node:sqlite` because the build environment blocked
Prisma's engine binaries. That decision was sound for local development and
would still work on a host with a persistent disk.

It does not work on serverless hosting. Vercel, and every comparable
platform, runs each request in a container with a **read-only filesystem** and
an ephemeral `/tmp` that is not shared between invocations. A file-backed
database there cannot be written to, and anything that *is* written disappears.
Worse, it would appear to work in local development and fail only once
deployed — the least useful possible failure mode.

The application is also multi-user by design: several people in two Dubai
stores and a UK office reading and writing the same stock. That requires one
shared database, not a file per instance.

## Decision

Use **PostgreSQL** via **postgres.js** with Drizzle's `postgres-js` driver.

- Managed Postgres is available on every host worth deploying to, with a free
  tier adequate for this workload (Neon, Supabase, Vercel Postgres, Railway).
- postgres.js is pure JavaScript — no native compilation, no downloaded
  binaries, so the constraint that ruled out Prisma still holds.
- It supports real interactive transactions, which the sqlite-proxy adapter
  could not express.

## Consequences

- **Transactions are now first-class.** `withTransaction` binds the active
  transaction to an `AsyncLocalStorage` context and `db` is a Proxy that
  resolves to it. Services are unchanged: they still import `db` and call it
  normally, but a nested repository call can no longer accidentally run outside
  the transaction its caller opened. Commit, rollback and nesting are covered
  by an integration check.
- **The connection is created lazily**, on first query rather than at module
  scope. ES module imports are hoisted, so a module-scope connection is built
  before a CLI entrypoint can call `loadEnv()` — which is exactly how the seed
  previously ended up reading an unset `DATABASE_URL`.
- **Connection pooling matters.** Each serverless instance opens its own pool,
  so `max` defaults to 5 and idle connections are reaped after 20 seconds.
  Point `DATABASE_URL` at a pooled endpoint in production.
- **Timestamps are `TIMESTAMPTZ`**, not integer epochs. The team spans UK and
  Gulf timezones; storing an absolute instant is the only correct choice.
- **The sqlite-proxy row-shape bug is gone.** That adapter needed
  `setReturnArrays(true)` because object rows collapsed duplicate column names
  on joins. postgres.js has no such hazard, and the guard test was removed with
  the adapter.
- `DATABASE_URL` starting with `file:` is now rejected at startup with an
  explicit message, so an old configuration fails loudly instead of silently
  serving an empty database.
