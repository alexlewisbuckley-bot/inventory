-- What a trade counterparty needs that a private buyer does not.
--
-- A dealer does not have a budget: they buy repeatedly, against terms, and the
-- questions you ask before selling to one are about credit and paperwork, not
-- what they can afford this year. Asking a private buyer for a VAT number, or
-- a dealer for their birthday, is how a form teaches people to ignore it.
--
-- All nullable: the fields only apply to one side of the book, and a customer
-- can move between sides.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_terms    TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit_gbp INTEGER;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS vat_no           TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS registration_no  TEXT;
-- A dealer is frequently a supplier too. Recording it lets the record show
-- both sides of the relationship instead of pretending they are two firms.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS supplier_id      TEXT REFERENCES suppliers (id);

CREATE INDEX IF NOT EXISTS customers_supplier_idx ON customers (supplier_id);
