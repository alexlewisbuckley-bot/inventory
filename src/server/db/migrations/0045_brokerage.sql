-- Money earned selling somebody else's watch.
--
-- A brokered deal has no stock behind it: we never bought the watch, so
-- there is no cost, no margin and nothing to mark as sold. It could not be
-- recorded at all, because `sales.watch_id` is NOT NULL and a sale without
-- a watch is not a row this schema can hold.
--
-- Deliberately its own table rather than a nullable `watch_id` on `sales`.
-- Seven queries inner-join sales to watches, so a null would quietly drop
-- these rows from the sales list, the customer's history and the reports —
-- and the ones that did show them would report an average sale price, a
-- margin and a stock turn computed over a thing that was never stock. A fee
-- is income, not trading revenue, and the two are added up separately
-- everywhere an accountant would expect them to be.
--
-- What it shares with a sale is the part that matters to the person who did
-- it: a date, who brought it in, whether it has been paid, and a figure in
-- the currency it was agreed in. The whole fee is the profit, so a
-- salesperson's commission is worked out on it exactly as it is on the
-- profit of a stock sale.

CREATE TABLE IF NOT EXISTS brokerages (
  id                TEXT PRIMARY KEY,
  -- What was sold, in words. There is no watch record to point at, and
  -- "Rolex Daytona 116500LN" is what makes the row recognisable a year
  -- later.
  description       TEXT NOT NULL,
  -- Who we sold it for, and who bought it, where either is worth keeping.
  -- Free text: neither is necessarily a customer on the book.
  sold_for          TEXT,
  sold_to           TEXT,
  -- The customer record, when the buyer is one of ours.
  customer_id       TEXT REFERENCES customers(id),
  brokered_on       TIMESTAMPTZ NOT NULL,
  reference         TEXT,

  -- The fee, in the currency it was agreed in, and in base minor units.
  -- Both kept for the same reason a sale keeps both: the agreed figure is
  -- what the paperwork says, and the base figure is what the reports add up.
  fee_amount        INTEGER NOT NULL,
  fee_currency      TEXT NOT NULL DEFAULT 'AED',
  fee_fx_rate       INTEGER,
  fee_base          INTEGER NOT NULL,

  payment_status    TEXT NOT NULL DEFAULT 'PAID',
  sold_by_id        TEXT REFERENCES sales_people(id) ON DELETE SET NULL,
  notes             TEXT,
  recorded_by_id    TEXT NOT NULL REFERENCES users(id),

  -- Voided rather than deleted, as a sale is: a fee invoiced and then
  -- cancelled is a fact, and the reports exclude it while the correction
  -- stays explicable.
  voided_at         TIMESTAMPTZ,
  voided_by_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  void_reason       TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

-- The month's figures, by person: the two questions every report asks.
CREATE INDEX IF NOT EXISTS brokerages_date_idx ON brokerages (brokered_on);
CREATE INDEX IF NOT EXISTS brokerages_person_idx ON brokerages (sold_by_id, brokered_on);
