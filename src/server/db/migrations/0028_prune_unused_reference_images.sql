-- Take the unused photographs off the shelf.
--
-- The library outlives the watches it was filled from, which is the point of
-- it — but that also means a picture withdrawn from every watch stays on the
-- shelf and keeps being offered. A batch shot on a white background was
-- replaced with cut-outs, deleted from the watches, and the white ones went
-- on being handed to the next watch of that reference.
--
-- So: anything on the shelf whose bytes are no longer on a watch of that same
-- brand and reference is removed. Matched on the bytes rather than on where
-- it came from, because the shelf copy and the watch copy are the same
-- photograph and nothing else ties them together.
--
-- One-shot, like every migration. The shelf is meant to accumulate, so this
-- is a tidy-up and not a rule; if it needs doing again it needs doing again
-- deliberately.
WITH in_use AS (
  SELECT DISTINCT
    w.brand_id,
    upper(regexp_replace(w.model, '[^A-Za-z0-9]', '', 'g')) AS reference,
    encode(sha256(i.data), 'hex') AS digest
  FROM watch_images i
  JOIN watches w ON w.id = i.watch_id
  WHERE i.kind = 'WATCH'
)
DELETE FROM reference_images r
WHERE NOT EXISTS (
  SELECT 1 FROM in_use u
  WHERE u.brand_id = r.brand_id
    AND u.reference = r.reference
    AND u.digest    = r.digest
);
