-- Remember what each push actually said, so the next one can tell what moved.
--
-- The storefront plan has always listed every watch with a page as "to
-- update", because that is all it could work out: it compared the book
-- against the shop's list of products and nothing finer. The screen therefore
-- read "143 to update" before a push and "143 to update" after one, Apply
-- re-sent the whole catalogue each time — photographs included — and the one
-- question the screen exists to answer had no answer on it.
--
-- This column holds a short string standing for everything the last
-- successful push sent: price, status, quantity, titles, photographs and the
-- structured fields. A watch whose string still matches what we would send is
-- already right and is skipped.
--
-- Deliberately left NULL for every existing row. Null means "we do not know
-- what the shop was last told", which counts as needing a push — so the first
-- run after this lands does the whole book once, exactly as today, and every
-- run after it does only the watches that actually moved.

ALTER TABLE watches ADD COLUMN IF NOT EXISTS shopify_fingerprint TEXT;
