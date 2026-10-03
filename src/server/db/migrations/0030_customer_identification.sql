-- Who they actually are, as against what they said their name was.
--
-- A watch leaves the building against a name typed into a box. For a
-- five-figure sale that is not a record of the buyer, it is a note of what
-- they told us — and the obligation, when somebody later asks who bought it,
-- falls on the dealer rather than on the salesperson who took the call.
--
-- The same shape as `supplier_documents` already uses for a director's
-- passport: what kind of document, whose, what number, when it expires, and
-- who looked at it. The last pair is what makes this a check rather than a
-- field: a number nobody confirmed against the document is a number somebody
-- read out over the phone.
ALTER TABLE customers ADD COLUMN id_kind TEXT;
ALTER TABLE customers ADD COLUMN id_number TEXT;

-- As printed on it. An in-date check against a lapsed passport is not a check.
ALTER TABLE customers ADD COLUMN id_expires_on DATE;
ALTER TABLE customers ADD COLUMN id_issuer TEXT;

-- Stamped when the number is first recorded, with whoever recorded it.
ALTER TABLE customers ADD COLUMN id_checked_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN id_checked_by_id TEXT REFERENCES users(id) ON DELETE SET NULL;

-- The one read worth an index: whose identification runs out, and when.
CREATE INDEX customers_id_expiry_idx ON customers (id_expires_on)
  WHERE id_expires_on IS NOT NULL AND deleted_at IS NULL;
