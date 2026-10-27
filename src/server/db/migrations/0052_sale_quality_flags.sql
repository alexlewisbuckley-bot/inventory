-- The two facts the data-quality flags were missing.
--
-- Alex's flags are meant to be on all the time, "not just at import":
--
--   invoice number blank or "TBA" more than 2 days after the sale date
--   customer blank
--   stock number blank
--   cost 0 on a Trade or Retail sale
--   unpaid and past due date
--   no matching Xero invoice on the last import
--
-- Four of the six can be read off a sale as it already stands. The other
-- two cannot, and this adds what they need.
--
-- A due date, because "past due" has to be past something. Xero states one
-- on every invoice and the system threw it away, so the only thing it
-- could say was "unpaid", which is not the same question — an invoice on
-- 30-day terms raised yesterday is unpaid and perfectly healthy. It joins
-- the list of fields Xero owns, for the same reason the others are on it.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS due_on timestamptz;

-- The dates an import covered, so "missing from the last import" can be
-- asked honestly.
--
-- Without them the flag can only compare a sale against the last import it
-- was seen in, which marks the entire back catalogue as missing the first
-- time anybody drops a file. A sale is only missing if it falls inside the
-- period the file was meant to account for.
ALTER TABLE xero_imports ADD COLUMN IF NOT EXISTS covers_from timestamptz;
ALTER TABLE xero_imports ADD COLUMN IF NOT EXISTS covers_to timestamptz;
