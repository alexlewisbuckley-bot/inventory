-- Who is actually behind the supplier, and the evidence for it.
--
-- A dealer in watches is a high value dealer for money-laundering purposes,
-- and the obligation is not satisfied by holding a company name. It is to have
-- identified a real person behind the company and to have looked at their
-- identity document. Until now the supplier book held a trading name, a VAT
-- number and whoever happened to answer the phone — none of which is a person
-- you have identified.
--
-- The identification expires after six months. Not because the person changes,
-- but because the evidence goes stale: directors resign, documents lapse, and
-- a passport copied two years ago proves what was true two years ago.

-- The named officer of the company, as distinct from the sales contact you
-- deal with day to day. Those are usually different people and conflating them
-- is how a due diligence file ends up naming a salesperson.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS director_name      TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS director_role      TEXT;
-- Date of birth, which is what makes a name match an identity document rather
-- than merely resemble one. Nullable: it is asked for, not extracted.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS director_dob       DATE;

-- The standing of the check itself.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS id_check_status    TEXT NOT NULL DEFAULT 'UNCHECKED';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS id_checked_at      TIMESTAMPTZ;
-- Who accepted the document. A check nobody's name is against is not a check,
-- and for identity evidence that is the whole point of the record.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS id_checked_by_id   TEXT REFERENCES users (id);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS id_check_notes     TEXT;
-- The expiry of the document this check was made against, copied here when the
-- check is recorded. Not a cache of "the latest document" — a fact about the
-- check itself, which is why it can be read without joining: an in-date check
-- made against a passport that has since lapsed is not identification, and
-- that has to be visible on a list of four hundred watches without four
-- hundred lookups.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS id_document_expires_on DATE;

CREATE INDEX IF NOT EXISTS suppliers_id_checked_idx ON suppliers (id_checked_at);

-- The document itself.
--
-- Kept in the row for the same reason invoices and stock photographs are: at a
-- few hundred kilobytes a scan this avoids a second service and a second set
-- of credentials, and a database backup stays a complete backup. Evidence you
-- cannot produce on request is evidence you do not have.
--
-- More sensitive than anything else stored here — these are passport scans —
-- so reading one is gated on supplier:manage rather than supplier:read, and
-- every read is written to the audit trail.
CREATE TABLE IF NOT EXISTS supplier_documents (
  id             TEXT PRIMARY KEY,
  supplier_id    TEXT NOT NULL REFERENCES suppliers (id),
  kind           TEXT NOT NULL DEFAULT 'PASSPORT',
  -- The name printed on the document, which is the thing that has to match the
  -- director's name rather than be assumed to.
  holder_name    TEXT,
  -- The document's own expiry, which is a different fact from when the check
  -- goes stale: an in-date check against an expired passport is not a check.
  expires_on     DATE,

  file_name      TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  byte_size      INTEGER NOT NULL,
  data           BYTEA NOT NULL,

  uploaded_by_id TEXT NOT NULL REFERENCES users (id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS supplier_documents_supplier_idx ON supplier_documents (supplier_id);
