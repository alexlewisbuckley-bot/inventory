-- One house, one row.
--
-- The brand picker had grown duplicates of the same maison typed slightly
-- differently — "Patek" sitting above "Patek Philippe", a short Vacheron
-- beside the full one — because the field let anybody add a brand by typing
-- into it. Picking the wrong one of a pair is not a cosmetic mistake: the
-- storefront groups by brand, the catalogue filters by it, and the customer
-- interest table is keyed on it, so a maison split across two rows is split
-- everywhere it is counted.
--
-- Two things fix it, and only one of them is here. The form no longer creates
-- a brand by typing; that stops new ones appearing. This merges the ones
-- already there.
--
-- Merged, never simply deleted. A short "Patek" may be carrying watches, and
-- dropping the row would either fail on the foreign key or take the stock
-- with it depending on which table was looking. Everything that points at the
-- duplicate is moved to the canonical row first, and the duplicate is removed
-- only once nothing refers to it at all — so this is safe to run against a
-- database where the duplicate was never used, and safe against one where it
-- was used for everything.
--
-- Matching is on the name with case, spaces and punctuation removed, because
-- that is the shape these mistakes take: "patek philippe", "Patek-Philippe"
-- and "PATEK PHILIPPE" are the same maison, and a slug comparison alone would
-- miss at least one of them.

-- The duplicates, each named against the row it should have been.
-- Dropped explicitly at the end rather than ON COMMIT, so this file behaves
-- the same whether it is run by the migration runner (which wraps each file
-- in one transaction) or statement by statement through psql. A migration
-- that only works under one of those is a migration that cannot be tested.
DROP TABLE IF EXISTS brand_merge;
CREATE TEMP TABLE brand_merge (bad_id TEXT PRIMARY KEY, good_id TEXT NOT NULL);

-- A misspelling and the maison it belongs to, stated as a pair.
--
-- This was first written as a bare list of wrong spellings, which is wrong in
-- a way worth recording: a list says a row is a duplicate but not what it is a
-- duplicate OF, so it matched every canonical brand at once and the tie-break
-- decided. Tested against a seeded database, a misspelled Audemars Piguet
-- merged into Rolex and took its stock with it.
DROP TABLE IF EXISTS brand_alias;
CREATE TEMP TABLE brand_alias (alias TEXT PRIMARY KEY, canonical TEXT NOT NULL);
INSERT INTO brand_alias (alias, canonical) VALUES
  ('pateekphilippe', 'patekphilippe'),
  ('pateekphilippegeneve', 'patekphilippe'),
  ('patekphilipe', 'patekphilippe'),
  ('patekphillipe', 'patekphilippe'),
  ('patekphillippe', 'patekphilippe'),
  ('patekphilippegeneve', 'patekphilippe'),
  ('audemaraspiguet', 'audemarspiguet'),
  ('audemarpiguet', 'audemarspiguet'),
  ('audemarspiquet', 'audemarspiguet'),
  ('vacheromconstantin', 'vacheronconstantin'),
  ('vacheronconstantine', 'vacheronconstantin'),
  ('vacheronconstantingeneve', 'vacheronconstantin'),
  ('richardmile', 'richardmille'),
  ('rolexwatches', 'rolex');

WITH flat AS (
  SELECT id, lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) AS key FROM brands
),
canonical AS (
  SELECT id, key FROM flat
  WHERE key IN (
    'rolex', 'patekphilippe', 'audemarspiguet', 'richardmille',
    'vacheronconstantin', 'cartier', 'hermes', 'omega'
  )
),
-- A duplicate is a row whose flattened name is a prefix of a canonical one,
-- or a known misspelling of that same canonical one. The prefix rule catches
-- "Patek" and "Vacheron"; the pairs above catch the ones that are not
-- prefixes because a letter is wrong rather than missing.
duplicate AS (
  SELECT f.id AS bad_id, c.id AS good_id, length(c.key) AS specificity
  FROM flat f
  JOIN canonical c ON c.id <> f.id AND c.key <> f.key
  LEFT JOIN brand_alias a ON a.alias = f.key AND a.canonical = c.key
  WHERE
    -- Four characters at least. A stray one- or two-letter row is junk, but
    -- it is a prefix of half the list, and "merging" it would move whatever
    -- stock it carried onto whichever maison sorted first.
    (length(f.key) >= 4 AND c.key LIKE f.key || '%')
    OR a.alias IS NOT NULL
)
INSERT INTO brand_merge (bad_id, good_id)
-- One target per duplicate. Where a short name is a prefix of two canonical
-- rows the longer NAME wins, as the more specific reading — not the longer
-- id, which is what this compared at first and which means nothing at all.
SELECT DISTINCT ON (bad_id) bad_id, good_id
FROM duplicate
ORDER BY bad_id, specificity DESC;

-- Stock first, since that is the reference that would refuse the delete.
UPDATE watches w SET brand_id = m.good_id
FROM brand_merge m WHERE w.brand_id = m.bad_id;

UPDATE watch_requests r SET brand_id = m.good_id
FROM brand_merge m WHERE r.brand_id = m.bad_id;

-- The photograph bank is unique on (brand, reference, digest), so a row can
-- only move to a brand that does not already hold that exact photograph of
-- that exact reference. Drop those first and move what is left: a straight
-- move rather than a copy, so nothing has to restate the column list or
-- recompute a digest.
DELETE FROM reference_images i
USING brand_merge m
WHERE i.brand_id = m.bad_id
  AND EXISTS (
    SELECT 1 FROM reference_images e
    WHERE e.brand_id = m.good_id AND e.reference = i.reference AND e.digest = i.digest
  );

UPDATE reference_images i SET brand_id = m.good_id
FROM brand_merge m WHERE i.brand_id = m.bad_id;

-- Customer interest is a composite key, so a customer who already follows the
-- canonical maison cannot simply have their row repointed at it.
INSERT INTO customer_brands (customer_id, brand_id)
SELECT DISTINCT c.customer_id, m.good_id
FROM customer_brands c
JOIN brand_merge m ON m.bad_id = c.brand_id
ON CONFLICT DO NOTHING;
DELETE FROM customer_brands c USING brand_merge m WHERE c.brand_id = m.bad_id;

DELETE FROM brands b USING brand_merge m WHERE b.id = m.bad_id;

-- Omega, which is not a duplicate of anything — it is a maison this house
-- does not deal in, added to the list and never used. Removed only if that
-- is actually true of the data: anything still pointing at it means somebody
-- bought one, and a brand with stock behind it stays whatever the list says.
DELETE FROM brands b
WHERE lower(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) = 'omega'
  AND NOT EXISTS (SELECT 1 FROM watches w WHERE w.brand_id = b.id)
  AND NOT EXISTS (SELECT 1 FROM watch_requests r WHERE r.brand_id = b.id)
  AND NOT EXISTS (SELECT 1 FROM reference_images i WHERE i.brand_id = b.id)
  AND NOT EXISTS (SELECT 1 FROM customer_brands c WHERE c.brand_id = b.id);

DROP TABLE brand_merge;
DROP TABLE brand_alias;
