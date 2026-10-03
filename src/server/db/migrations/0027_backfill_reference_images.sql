-- Put everything already photographed onto the shelf.
--
-- The library banks a photograph as it is uploaded, which means it started
-- empty and stayed empty for every watch photographed before it existed. The
-- effect on the day it shipped was the worst possible one: stock 1480 is a
-- 326938 with no picture, stock 1481 and 1509 are 326938s with one each, and
-- the library said "nothing has been photographed for this reference yet"
-- while two photographs of exactly that reference sat in the next card along.
--
-- So the shelf is seeded from what is already there. Photographs of the watch
-- only — a warranty card belongs to the one watch whose serial is on it.
INSERT INTO reference_images (
  id, brand_id, reference, label, mime_type, byte_size, width, height, data, digest, created_at, created_by_id
)
SELECT DISTINCT ON (w.brand_id, upper(regexp_replace(w.model, '[^A-Za-z0-9]', '', 'g')), encode(sha256(i.data), 'hex'))
  -- Generated here rather than by the application, so these ids are a uuid
  -- rather than the sortable base-36 the rest of the table will carry. Ids
  -- are opaque and nothing reads them; it is not worth a migration runner
  -- that can execute TypeScript.
  'ref_' || replace(gen_random_uuid()::text, '-', ''),
  w.brand_id,
  upper(regexp_replace(w.model, '[^A-Za-z0-9]', '', 'g')),
  w.model,
  i.mime_type,
  i.byte_size,
  i.width,
  i.height,
  i.data,
  encode(sha256(i.data), 'hex'),
  i.created_at,
  i.created_by_id
FROM watch_images i
JOIN watches w ON w.id = i.watch_id
WHERE i.kind = 'WATCH'
  -- A reference that is only punctuation is not a shelf.
  AND upper(regexp_replace(w.model, '[^A-Za-z0-9]', '', 'g')) <> ''
ORDER BY
  w.brand_id,
  upper(regexp_replace(w.model, '[^A-Za-z0-9]', '', 'g')),
  encode(sha256(i.data), 'hex'),
  -- The oldest copy of a photograph is the original upload; keep its date.
  i.created_at
ON CONFLICT DO NOTHING;
