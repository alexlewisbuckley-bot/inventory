-- Full set unless somebody says otherwise.
--
-- Alex: "Lots of watches are being imported without full set on website, can
-- we have default for import and new watches to be full set we can update to
-- watch only where required as 99% of stock is full set."
--
-- The column has defaulted to UNKNOWN since the beginning, and the storefront
-- treats UNKNOWN as nothing to say: the box-and-papers metafield is left off
-- the product entirely, so the one fact a buyer of a second-hand watch asks
-- about first was simply absent from most of the shop.
--
-- UNKNOWN was the honest default while nobody could say what the stock was.
-- It is not the honest default for this stock: the shop buys full sets, and
-- a column whose value is wrong on 99% of rows is not caution, it is noise
-- with a clean conscience. The exception is now the thing worth recording.
--
-- This does not make the claim true, and nothing here checks a box exists.
-- It states what the shop knows about its own buying and leaves the dropdown
-- one click from the watch for the rest.
ALTER TABLE watches
  ALTER COLUMN box_papers SET DEFAULT 'FULL_SET';

-- Deliberately not the wants table. `watch_requests.box_papers` records what a
-- customer will accept, where UNKNOWN means "no preference" and is a real
-- answer rather than a gap. Defaulting that to FULL_SET would turn every
-- loose enquiry into a demand for one and quietly narrow what we offer them.

-- The stock already on the book, which is what the website is showing today.
--
-- Written to the audit trail before it is changed, so this is a batch that
-- can be found and undone rather than a silent rewrite: every row it touches
-- is listed, with its old value, against the watch it belongs to.
--
-- Ids are md5-derived rather than the application's sortable form, which this
-- file has no way to generate. They are the same alphabet and the same width;
-- what they give up is index locality on one batch of inserts, once.
INSERT INTO audit_logs (id, entity_type, entity_id, action, changes, summary, actor_id)
SELECT
  'aud_' || substr(md5(random()::text || w.id), 1, 21),
  'watch',
  w.id,
  'UPDATE',
  '{"boxPapers":{"from":"UNKNOWN","to":"FULL_SET"}}',
  'Box and papers set to full set, with the default, for stock in hand',
  NULL
FROM watches w
WHERE w.box_papers = 'UNKNOWN'
  AND w.deleted_at IS NULL
  -- Stock in hand only. A sold or written-off record describes a watch that
  -- has already gone, and what it said at the time is what the buyer was
  -- told; rewriting that is changing history rather than fixing the shop.
  -- RESERVED, SALE_AGREED and RETURNED are all still ours.
  AND w.status NOT IN ('SOLD', 'WRITTEN_OFF');

UPDATE watches
SET box_papers = 'FULL_SET',
    updated_at = now(),
    -- Bumped, because the row changed and the rest of the application reads
    -- this to decide whether somebody is saving over work they never saw. A
    -- form opened before this ran now gets the conflict it should get,
    -- instead of silently writing UNKNOWN back over the row on save.
    version = version + 1
WHERE box_papers = 'UNKNOWN'
  AND deleted_at IS NULL
  AND status NOT IN ('SOLD', 'WRITTEN_OFF');
