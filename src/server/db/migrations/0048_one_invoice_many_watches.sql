-- One invoice, many watches.
--
-- A sale row is one watch leaving the building, and the invoice number was
-- unique across live rows — so a customer buying ten watches on one invoice
-- could be given exactly one of them. The second attempt was refused with
-- "that invoice number has already been used", which described the index
-- rather than anything true about the business.
--
-- The number stays indexed, because looking a sale up by the invoice the
-- customer is holding is the commonest search on the ledger. It is simply
-- no longer unique. Nothing else enforced one-watch-per-invoice: the guard
-- against booking the same watch twice is its SOLD status, which is
-- untouched and is the check that actually matters.

DROP INDEX IF EXISTS sales_invoice_live_idx;

CREATE INDEX IF NOT EXISTS sales_invoice_live_idx
  ON sales (invoice_no)
  WHERE deleted_at IS NULL AND voided_at IS NULL;
