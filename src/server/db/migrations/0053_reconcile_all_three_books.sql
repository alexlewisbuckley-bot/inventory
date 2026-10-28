-- A Xero invoice can be for any of the three things we invoice for.
--
-- Alex: "there are quite a few sales that are not linking, and I think
-- it's due to commissions not being tracked and buybacks."
--
-- The matcher only ever read the sales table, so an invoice for a brokered
-- fee or a buy-back charge had nothing it could match. Widening it is most
-- of the fix; this is the part that lets the answer be stored, because
-- `xero_links.sale_id` was NOT NULL and pointed at `sales` alone.
--
-- Three typed columns rather than one untyped id, so the database still
-- enforces that a link points at something real and still cleans up after
-- a deleted row. Exactly one of them is set, which the check below states
-- rather than leaves to the application to remember.

ALTER TABLE xero_links ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'SALE';

ALTER TABLE xero_links ADD COLUMN IF NOT EXISTS brokerage_id text
  REFERENCES brokerages (id) ON DELETE CASCADE;

ALTER TABLE xero_links ADD COLUMN IF NOT EXISTS buyback_charge_id text
  REFERENCES buyback_charges (id) ON DELETE CASCADE;

-- Was NOT NULL. A link to a commission has no sale behind it.
ALTER TABLE xero_links ALTER COLUMN sale_id DROP NOT NULL;

-- Exactly one target, always.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'xero_links_one_target'
  ) THEN
    ALTER TABLE xero_links ADD CONSTRAINT xero_links_one_target CHECK (
      (CASE WHEN sale_id IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN brokerage_id IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN buyback_charge_id IS NULL THEN 0 ELSE 1 END) = 1
    );
  END IF;
END $$;

-- The old index said a sale appears once per import. The same has to hold
-- for a commission and a charge, so it moves onto whichever target the row
-- actually has.
DROP INDEX IF EXISTS xero_links_sale_idx;

CREATE UNIQUE INDEX IF NOT EXISTS xero_links_target_idx
  ON xero_links (import_id, coalesce(sale_id, brokerage_id, buyback_charge_id));

-- Which import last accounted for a commission or a charge, so the
-- "nothing in Xero matched this" flag can be asked of them too rather than
-- only of sales.
ALTER TABLE brokerages ADD COLUMN IF NOT EXISTS xero_seen_import_id text
  REFERENCES xero_imports (id) ON DELETE SET NULL;

ALTER TABLE buyback_charges ADD COLUMN IF NOT EXISTS xero_seen_import_id text
  REFERENCES xero_imports (id) ON DELETE SET NULL;
