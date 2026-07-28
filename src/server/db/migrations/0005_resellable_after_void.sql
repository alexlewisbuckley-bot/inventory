-- A voided sale must not block the watch from ever being sold again.
--
-- `sales_watch_idx` was a plain unique index on watch_id, written when a sale
-- was a one-way door. Voiding made that assumption false: the watch returns to
-- stock, somebody sells it to the right buyer, and the insert fails with a
-- constraint violation and a toast saying only "Could not record the sale."
--
-- The invariant that actually matters is "one *live* sale per watch", so the
-- index becomes partial. History is kept and the guarantee is unchanged for
-- every sale that still counts.

DROP INDEX IF EXISTS sales_watch_idx;

CREATE UNIQUE INDEX IF NOT EXISTS sales_watch_live_idx
  ON sales (watch_id)
  WHERE deleted_at IS NULL AND voided_at IS NULL;

-- Same reasoning for the invoice number. The commonest reason to void is
-- having recorded the sale against the wrong stock number, and the next thing
-- you do is enter it again — with the same invoice, because the invoice the
-- customer holds has not changed.

DROP INDEX IF EXISTS sales_invoice_idx;

CREATE UNIQUE INDEX IF NOT EXISTS sales_invoice_live_idx
  ON sales (invoice_no)
  WHERE deleted_at IS NULL AND voided_at IS NULL;
