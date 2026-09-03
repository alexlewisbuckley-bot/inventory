-- Two checks, two cadences.
--
-- Buying stock in this trade carries two specific liabilities, and both were
-- being carried in somebody's head. The first is the supplier: reclaiming VAT
-- against a number that turns out not to be registered is money you repay,
-- with interest, and a registration can be cancelled on any day of the year —
-- so the check expires and has to be made again. The second is the watch:
-- title does not pass on stolen goods, so a piece found on The Watch Register
-- after you have sold it is returned to its owner and both the watch and the
-- money are gone. That check is per serial number and is made once.
--
-- The columns are on the two tables the facts belong to rather than in a
-- checks table of their own: there is exactly one current answer per supplier
-- and per watch, and the history of how it got there is already the audit
-- trail's job.

-- The supplier's VAT standing, as HMRC last reported it.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS vat_check_status       TEXT NOT NULL DEFAULT 'UNCHECKED';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS vat_checked_at         TIMESTAMPTZ;
-- The name and address on the registration, which is the half of the answer
-- worth keeping: a number that is registered to somebody else is a different
-- problem from one that is not registered at all, and only this reveals it.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS vat_check_name         TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS vat_check_address      TEXT;
-- HMRC's dated proof that the check was made. The thing you produce if a
-- reclaim is ever questioned, so it is stored rather than merely displayed.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS vat_check_reference    TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS vat_check_message      TEXT;

-- Finding the ones that have fallen due, without reading every supplier.
CREATE INDEX IF NOT EXISTS suppliers_vat_checked_idx ON suppliers (vat_checked_at);

-- The watch against The Watch Register.
ALTER TABLE watches ADD COLUMN IF NOT EXISTS register_check_status  TEXT NOT NULL DEFAULT 'UNCHECKED';
ALTER TABLE watches ADD COLUMN IF NOT EXISTS register_checked_at    TIMESTAMPTZ;
-- Who ran the search. A check nobody's name is against is not a check.
ALTER TABLE watches ADD COLUMN IF NOT EXISTS register_checked_by_id TEXT REFERENCES users (id);
-- The register's own search or certificate reference, where one was issued.
ALTER TABLE watches ADD COLUMN IF NOT EXISTS register_check_ref     TEXT;
ALTER TABLE watches ADD COLUMN IF NOT EXISTS register_check_notes   TEXT;

-- The list every morning starts from: live stock not yet searched. Partial, so
-- it stays small as the checked pile grows past the unchecked one.
CREATE INDEX IF NOT EXISTS watches_register_pending_idx
  ON watches (register_check_status)
  WHERE deleted_at IS NULL AND register_check_status = 'UNCHECKED';
