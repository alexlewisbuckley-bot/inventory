-- The storefront as a mirror of the book.
--
-- The shop and the inventory system have been two separate accounts of the
-- same stock, kept in step by somebody remembering. They had drifted: a watch
-- priced at $10,200 here was listed at 37,832 dirhams there (about $10,301),
-- one stock number had two live product pages at two different prices, and
-- three products carried no stock number at all.
--
-- So the book becomes the source and the store becomes a reflection of it.
-- Nothing flows the other way, which is what makes this tractable: there is no
-- merge to perform, only a difference to apply.
--
-- The join key needed no inventing. The store already used the stock number as
-- the SKU, so these columns are a cache of what the last sync found rather
-- than the thing that makes the match — which matters, because it means losing
-- them costs one reconcile rather than the mapping itself.
ALTER TABLE watches ADD COLUMN IF NOT EXISTS shopify_product_id TEXT;
ALTER TABLE watches ADD COLUMN IF NOT EXISTS shopify_synced_at TIMESTAMPTZ;

-- Why the last push failed, kept on the row rather than only in the log.
--
-- A sync that fails silently is worse than no sync: the store goes on showing
-- a price nobody has checked, and the first anybody hears of it is a customer
-- quoting it back. The failure belongs where somebody looking at the watch
-- will see it.
ALTER TABLE watches ADD COLUMN IF NOT EXISTS shopify_error TEXT;

CREATE INDEX IF NOT EXISTS watches_shopify_idx ON watches (shopify_product_id)
  WHERE shopify_product_id IS NOT NULL;

-- Which photographs the store already holds.
--
-- Images are the expensive part of a push — bytes out of Postgres and up to a
-- CDN — and re-sending an unchanged photograph on every price change would
-- turn a cheap sync into a slow one. The media id is how a photograph that is
-- already there is recognised as already there.
ALTER TABLE watch_images ADD COLUMN IF NOT EXISTS shopify_media_id TEXT;
