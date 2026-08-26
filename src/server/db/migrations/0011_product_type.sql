-- What kind of thing a stock record is.
--
-- The business buys watches. Occasionally a deal carries a handbag or a piece
-- of jewellery, and until now those were entered as watches — the only trace
-- of what they actually were being whatever somebody wrote in the notes, which
-- no filter, report or export could read.
--
-- Defaults to WATCH, which is both the right default for new stock and the
-- truth about every row that existed before this column: the system has never
-- held anything else.

ALTER TABLE watches ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'WATCH';

-- Partial, like the other inventory indexes: the queries that filter on type
-- are looking at live stock, and deleted rows are never in the answer.
CREATE INDEX IF NOT EXISTS watches_product_type_idx
  ON watches (product_type) WHERE deleted_at IS NULL;
