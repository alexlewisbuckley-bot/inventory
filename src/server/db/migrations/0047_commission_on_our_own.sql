-- A commission earned on a watch that was on our own book.
--
-- Brokerage was built for a watch we never owned, which is the common case:
-- somebody asks us to sell theirs and pays us a fee. But a piece can sit in
-- our inventory — on consignment, or bought and then placed for an owner —
-- and go out the same way. Until now that left two bad options: record it
-- as a direct sale, which invents a cost and a margin that never existed,
-- or record a commission and leave the watch sitting in stock and on the
-- website after it had gone.
--
-- Nullable, because the common case stays the common case: most fees have
-- no watch of ours behind them and never will.
--
-- No cascade. A watch is soft-deleted rather than removed, and the fee is
-- an accounting fact that should outlive any tidying of the stock record —
-- so the link goes null and the money stays.

ALTER TABLE brokerages ADD COLUMN IF NOT EXISTS watch_id TEXT REFERENCES watches(id) ON DELETE SET NULL;

-- One fee per watch at most. Two commissions against the same piece is a
-- double count of the same event, and the constraint is cheaper than
-- finding it in a month's figures.
CREATE UNIQUE INDEX IF NOT EXISTS brokerages_watch_idx
  ON brokerages (watch_id) WHERE watch_id IS NOT NULL AND voided_at IS NULL AND deleted_at IS NULL;
