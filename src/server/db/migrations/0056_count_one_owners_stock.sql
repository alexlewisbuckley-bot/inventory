-- Counting one owner's watches at a time.
--
-- Alex: "Add owner filtering to stock checks so we can check as we store the
-- watches."
--
-- The stock is put away by whose it is, so that is how it gets counted: one
-- owner's shelf, one check. Until now a check could only be narrowed to a
-- location, which means counting a safe holding three owners' stock was one
-- long list that had to be finished in a sitting -- and the file's own rule
-- is that a check nobody finishes is worth nothing.
--
-- Null means every owner, exactly as a null location already means
-- everywhere. Nothing is backfilled: every check taken so far did cover
-- every owner, so null is not a gap in those rows, it is the truth about
-- them.
ALTER TABLE stock_checks
  ADD COLUMN IF NOT EXISTS owner_id text REFERENCES owners (id);

-- The clash rule reads this alongside location to decide whether two open
-- checks cover any of the same watches, which is a scan of the few open
-- rows rather than a lookup -- but the pair is also what the list screen
-- groups by, and there will be one of these per owner per count from now on.
CREATE INDEX IF NOT EXISTS stock_checks_owner_idx ON stock_checks (owner_id);
