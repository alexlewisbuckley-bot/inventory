-- Suppliers become a trading record rather than a name and a phone number.
--
-- Buying a watch abroad means knowing who you are actually contracting with,
-- how to pay them and on what terms. The previous shape could not answer any
-- of that, so purchase paperwork lived outside the system.
--
-- Every column is nullable: existing suppliers were captured with a name only
-- and must keep working untouched until someone fills the rest in.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS legal_name        TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS entity_type       TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS registration_no   TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS vat_no            TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS website           TEXT;

-- The named human you actually deal with.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_role      TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_phone     TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_email     TEXT;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address_line1     TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address_line2     TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS city              TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS postcode          TEXT;

-- Commercial terms.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_terms     TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_currency  TEXT NOT NULL DEFAULT 'GBP';

CREATE INDEX IF NOT EXISTS suppliers_country_idx ON suppliers (country);


-- Sales record who bought the watch, not only what it fetched.
--
-- The quick-sell path captured an amount and an invoice number and nothing
-- about the buyer, so the ledger could not answer "who has this watch now?" —
-- the first question asked when one comes back.

ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_phone   TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_company TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_country TEXT;

-- Reversal. A sale recorded in error previously left the watch stuck in SOLD
-- with no way back, because deleting the sale row would have destroyed the
-- audit trail. Voiding keeps the record and explains itself.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_at     TIMESTAMPTZ;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_by_id  TEXT REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS void_reason   TEXT;

CREATE INDEX IF NOT EXISTS sales_voided_idx ON sales (voided_at);
