-- What the business costs to run, before a single watch is sold.
--
-- Gross profit has been in here since the beginning and net profit has never
-- been, because the rent was not. A dealer reading a month of AED 74,000
-- gross has no way to tell from this system whether that was a good month or
-- a loss, and that is the one question the numbers exist to answer.
--
-- Only the costs that are typed in live here. The sales retainers and the
-- commission are already recorded against each salesperson and are read from
-- there, so a wage cannot be entered twice and the P&L cannot drift from the
-- commission report. The guard is structural rather than a warning: there is
-- nowhere to type a salesperson's retainer on this table.

CREATE TABLE IF NOT EXISTS overheads (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  -- Grouped so the report can subtotal without anybody having to agree on
  -- what counts as "admin". Free text would make two spellings of "Rent"
  -- into two lines of the P&L.
  category    TEXT NOT NULL DEFAULT 'OTHER',
  -- Base minor units — dirham fils — per occurrence, not per month. A rent
  -- billed quarterly is stored as the quarter's figure and the report
  -- divides; storing a third of it would lose the number on the invoice.
  amount      INTEGER NOT NULL,
  -- MONTHLY | QUARTERLY | ANNUAL | ONE_OFF
  cadence     TEXT NOT NULL DEFAULT 'MONTHLY',
  -- A cost belongs to the months it was actually being paid in. Without
  -- these, adding the rent today would rewrite every month of history and a
  -- cost that ended in March would go on being charged in October.
  starts_on   DATE NOT NULL,
  ends_on     DATE,
  notes       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS overheads_active_idx ON overheads (is_active);
CREATE INDEX IF NOT EXISTS overheads_period_idx ON overheads (starts_on, ends_on);

-- No seed rows. Everything here is a real amount somebody is actually
-- paying, and a plausible-looking placeholder rent would quietly become part
-- of a net profit figure that somebody then believes.
