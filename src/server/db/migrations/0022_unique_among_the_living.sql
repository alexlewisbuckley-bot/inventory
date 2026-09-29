-- Deleting something should give its name back.
--
-- Locations, owners, resellers and suppliers are all soft-deleted: the row
-- stays, carrying its slug, with deleted_at set. Every one of them was covered
-- by a unique index over the whole table, so a deleted name stayed reserved
-- forever. The application's own duplicate check ignores deleted rows — it is
-- written to allow exactly this — and then the insert hit the index instead:
--
--   ERROR: duplicate key value violates unique constraint "resellers_slug_idx"
--
-- Which reached the user as a form that did nothing at all when they pressed
-- the button. Delete a reseller, try to add one back under the same name, and
-- there was no way to do it and nothing saying why.
--
-- Uniqueness belongs among the live rows, which is what the application has
-- always meant by it. A deleted row keeps its slug for its own history and
-- stops standing in the way of a new one.

DROP INDEX IF EXISTS resellers_slug_idx;
CREATE UNIQUE INDEX resellers_slug_idx ON resellers (slug) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS owners_slug_idx;
CREATE UNIQUE INDEX owners_slug_idx ON owners (slug) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS locations_slug_idx;
CREATE UNIQUE INDEX locations_slug_idx ON locations (slug) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS suppliers_name_idx;
CREATE UNIQUE INDEX suppliers_name_idx ON suppliers (name) WHERE deleted_at IS NULL;

-- Asserted rather than assumed: a partial index that failed to build would
-- leave these tables with no uniqueness at all, which is worse than the
-- problem it replaces.
DO $$
DECLARE missing TEXT;
BEGIN
  SELECT string_agg(name, ', ') INTO missing FROM (
    SELECT unnest(ARRAY[
      'resellers_slug_idx', 'owners_slug_idx', 'locations_slug_idx', 'suppliers_name_idx'
    ]) AS name
  ) wanted
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
    WHERE c.relname = wanted.name AND i.indisunique AND i.indpred IS NOT NULL
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'These unique indexes are missing or not partial: %', missing;
  END IF;
END $$;
