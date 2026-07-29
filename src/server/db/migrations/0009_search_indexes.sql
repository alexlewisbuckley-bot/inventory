-- Search that still answers in under 100ms at ten times this much data.
--
-- The palette was a watch-finder: one table, `ILIKE '%term%'`, eight rows. That
-- pattern cannot use a B-tree at all — a leading wildcard makes the index
-- useless — so it degrades to a sequential scan of every row in the table, and
-- it degrades quietly. At seed size it is instant. At 10,000 watches and 5,000
-- contacts across six tables it is not, and by then the palette is the primary
-- navigation surface and everybody has already stopped using it.
--
-- Trigram indexes are the fix. pg_trgm breaks each value into three-character
-- runs and indexes those, which is what makes `%reinhard%` an index lookup
-- rather than a scan. GIN over GiST because these columns are read constantly
-- and written rarely, which is exactly the trade GIN makes.
--
-- Everything here is additive: indexes and one extension. No table changes, no
-- data migration, nothing to roll back beyond dropping an index.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- --------------------------------------------------------------------------
-- Watches
-- --------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS watches_model_trgm ON watches USING gin (model gin_trgm_ops);
CREATE INDEX IF NOT EXISTS watches_serial_trgm ON watches USING gin (serial gin_trgm_ops);
CREATE INDEX IF NOT EXISTS watches_nickname_trgm ON watches USING gin (nickname gin_trgm_ops);

-- The stock number is quoted down a phone far more often than it is typed in
-- full, so "114" has to find 1147. Indexing the text form is what allows the
-- prefix match; the integer index alone cannot serve it.
CREATE INDEX IF NOT EXISTS watches_stock_no_text
  ON watches USING gin ((stock_no::text) gin_trgm_ops);

-- --------------------------------------------------------------------------
-- Contacts
-- --------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS customers_first_name_trgm ON customers USING gin (first_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_last_name_trgm ON customers USING gin (last_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_company_trgm ON customers USING gin (company gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_email_trgm ON customers USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_reference_trgm ON customers USING gin (reference gin_trgm_ops);

-- A phone number is stored the way somebody wrote it down — +44 7700 900123,
-- 07700 900123, (0)7700-900123 — and searched the way somebody remembers it,
-- which is never the same way. Both sides are stripped to digits, and the
-- expression index is what stops that stripping costing a full scan.
CREATE INDEX IF NOT EXISTS customers_phone_digits
  ON customers USING gin ((regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_alt_phone_digits
  ON customers USING gin ((regexp_replace(coalesce(alt_phone, ''), '[^0-9]', '', 'g')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS suppliers_name_trgm ON suppliers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS suppliers_contact_trgm ON suppliers USING gin (contact_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS suppliers_email_trgm ON suppliers USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS suppliers_phone_digits
  ON suppliers USING gin ((regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) gin_trgm_ops);

-- --------------------------------------------------------------------------
-- Work
-- --------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS deals_title_trgm ON deals USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS deals_reference_trgm ON deals USING gin (reference gin_trgm_ops);
CREATE INDEX IF NOT EXISTS sales_invoice_trgm ON sales USING gin (invoice_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tasks_title_trgm ON tasks USING gin (title gin_trgm_ops);

-- --------------------------------------------------------------------------
-- Recency
-- --------------------------------------------------------------------------
--
-- Ranking puts recently touched records above better textual matches, because
-- in this product people return to the same twenty records for a fortnight.
-- These indexes are what make "order by updated_at" free once the trigram
-- index has narrowed the candidates.

CREATE INDEX IF NOT EXISTS watches_updated_at_idx ON watches (updated_at DESC);
CREATE INDEX IF NOT EXISTS customers_updated_at_idx ON customers (updated_at DESC);
CREATE INDEX IF NOT EXISTS deals_updated_at_idx ON deals (updated_at DESC);
