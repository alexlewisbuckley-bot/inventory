# ADR 0001 — Data layer: Drizzle ORM over `node:sqlite`

**Status:** Accepted · **Date:** 2026-07-28

## Context

The application needs a typed, migration-driven persistence layer. Prisma was
the first choice, but Prisma downloads platform-specific query-engine binaries
at install time, and the build environment blocks `binaries.prisma.sh`. An ORM
that requires a network fetch of native artefacts is also a liability in
air-gapped CI and in hardened container registries.

`better-sqlite3` was evaluated second and rejected: it compiles native bindings
via `node-gyp`, which fails without a toolchain and prebuilt-binary access.

## Decision

Use **Drizzle ORM** with the **`sqlite-proxy`** driver, backed by Node's
built-in **`node:sqlite`** module (`DatabaseSync`, available from Node 22).

- Drizzle is distributed as pure TypeScript/JavaScript — no postinstall step,
  no native compilation, no binary download.
- `node:sqlite` ships inside the Node runtime, so the database driver has zero
  dependencies and zero supply-chain surface.
- `sqlite-proxy` is Drizzle's supported "bring your own driver" adapter; the
  callback in `src/server/db/client.ts` is the only glue required.

## Consequences

- **Transactions** are not provided by `sqlite-proxy`. `withTransaction()` in
  `src/server/db/client.ts` wraps the raw connection in explicit
  `BEGIN`/`COMMIT`/`ROLLBACK`, which every multi-statement service uses.
- **Migrations** are plain, reviewable SQL files in `src/server/db/migrations`,
  applied in lexical order by `src/server/db/migrate.ts` and tracked in a
  `_migrations` table. This avoids depending on drizzle-kit at runtime.
- **Postgres migration path** is preserved: the schema avoids SQLite-only
  types, money is integer minor units, and enums are `text` columns with
  TypeScript-level unions. Moving to Postgres means swapping the driver in
  `client.ts` and translating the migration SQL — the query layer is unchanged.
- `node:sqlite` is flagged experimental in Node 22 and prints a warning; it is
  suppressed in `package.json` scripts via `--no-warnings=ExperimentalWarning`.
