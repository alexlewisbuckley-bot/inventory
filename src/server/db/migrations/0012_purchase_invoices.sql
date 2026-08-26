-- Stock arrives as a PDF, not as a form.
--
-- Every purchase already came with a supplier invoice carrying everything the
-- intake form asks for — brand, reference, serial, cost, VAT treatment — and
-- somebody retyped it, once per watch, from a document that was then filed
-- somewhere else entirely. This table is that document: the bytes as sent, the
-- figures read out of it, and the link from each watch to the paperwork that
-- bought it.
--
-- The document is stored in the row for the same reason watch images are: at a
-- few hundred kilobytes an invoice this avoids a second service and a second
-- set of credentials, and it keeps a database backup a complete backup. An
-- invoice you cannot produce on request is an invoice you do not have.

CREATE TABLE IF NOT EXISTS purchase_invoices (
  id                TEXT PRIMARY KEY,
  supplier_id       TEXT NOT NULL REFERENCES suppliers (id),
  invoice_no        TEXT,
  invoice_date      TIMESTAMPTZ,

  currency          TEXT NOT NULL DEFAULT 'GBP',
  -- Minor units, in the currency above. Nullable: an invoice that states only
  -- a total is still a usable invoice.
  net_amount        INTEGER,
  vat_amount        INTEGER,
  gross_amount      INTEGER,
  vat_scheme        TEXT NOT NULL DEFAULT 'UNKNOWN',

  file_name         TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  byte_size         INTEGER NOT NULL,
  data              BYTEA NOT NULL,
  -- The text as extracted, kept so a parse can be re-run and audited later
  -- without asking anyone to upload the document a second time.
  raw_text          TEXT,

  extracted_by      TEXT NOT NULL DEFAULT 'RULES',
  -- How the supplier on the document was reconciled with the supplier book:
  -- EXACT, VAT_NO, FUZZY or CREATED. "CREATED" is the interesting one.
  supplier_match    TEXT NOT NULL DEFAULT 'CREATED',
  line_count        INTEGER NOT NULL DEFAULT 0,
  created_count     INTEGER NOT NULL DEFAULT 0,
  -- Lines that could not be booked in, as JSON, so nothing is silently lost.
  issues            TEXT,

  created_by_id     TEXT NOT NULL REFERENCES users (id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS purchase_invoices_supplier_idx ON purchase_invoices (supplier_id);
CREATE INDEX IF NOT EXISTS purchase_invoices_date_idx ON purchase_invoices (invoice_date);

-- The watch and the paperwork that bought it, joined.
ALTER TABLE watches ADD COLUMN IF NOT EXISTS invoice_id      TEXT REFERENCES purchase_invoices (id);
ALTER TABLE watches ADD COLUMN IF NOT EXISTS vat_scheme      TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE watches ADD COLUMN IF NOT EXISTS vat_amount_gbp  INTEGER;

CREATE INDEX IF NOT EXISTS watches_invoice_idx ON watches (invoice_id);
