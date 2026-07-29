-- Views somebody made, rather than views somebody shipped.
--
-- V1 had six saved views for stock, hard-coded in a TypeScript array. They
-- were the right six for the person who wrote them and nobody else could add a
-- seventh — so the queries people actually run every morning (this supplier's
-- consignment stock, everything over twenty thousand that has not moved,
-- trade contacts in the Gulf) stayed as three dropdown interactions rebuilt
-- from memory, several times a day, for the life of the product.
--
-- A view is a name and a query string. Nothing more: the query string already
-- carries filters, sort, search and column choices, and it is already the
-- shareable representation of a list. Storing anything richer would be storing
-- the same thing twice.

CREATE TABLE IF NOT EXISTS saved_views (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Which list it belongs to: 'watch', 'contact', 'sale'. Text rather than an
  -- enum type, matching every other enum-like column in this schema, which are
  -- all declared once in src/lib/enums.ts.
  object      TEXT NOT NULL,

  name        TEXT NOT NULL,

  -- The query string, without the leading '?'. Re-parsed and re-validated by
  -- src/lib/filters.ts on the way out, so a view saved before a column was
  -- renamed degrades to the filters that still make sense rather than
  -- breaking the list it opens.
  query       TEXT NOT NULL,

  -- Shared views are visible to everybody. Deliberately not "shared with
  -- these people": a two-person shop does not need an access-control matrix on
  -- a list of filters, and adding one now would be a schema nobody can remove.
  shared      BOOLEAN NOT NULL DEFAULT false,

  sort_order  INTEGER NOT NULL DEFAULT 0,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

-- One name per person per list. Case-insensitive, because "Ageing" and
-- "ageing" being two different views is a distinction nobody intends and
-- everybody trips over. Partial, so a deleted view frees its name.
CREATE UNIQUE INDEX IF NOT EXISTS saved_views_name_idx
  ON saved_views (user_id, object, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS saved_views_lookup_idx
  ON saved_views (object, user_id)
  WHERE deleted_at IS NULL;
