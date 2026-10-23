-- Money lent against watches we hold as security.
--
-- A buy-back is not a sale and not a brokered deal. The customer keeps
-- ownership; we advance them a sum, hold their watches, and earn interest
-- every month until they redeem. Nothing has been bought, so there is no
-- cost and no margin — but unlike a fee, the principal is capital out that
-- we expect back, and recording it as an expense would read as a loss every
-- time we wrote a loan.
--
-- So three tables, not one. The loan is the agreement. The items are the
-- watches securing it, which are not ours and must never appear in stock
-- while the loan is live. The charges are the money: one row per month of
-- interest plus any extension fee, each with its own payment status,
-- because "they have paid four of six months" is the question this exists
-- to answer and a single running total cannot.

CREATE TABLE IF NOT EXISTS buybacks (
  id                 TEXT PRIMARY KEY,
  reference          TEXT,
  -- Who we lent to. The customer record where they are on the book, and
  -- the name either way, as a sale keeps both.
  customer_id        TEXT REFERENCES customers(id),
  customer_name      TEXT NOT NULL,

  -- What we advanced, in the currency it was agreed in and in base minor
  -- units, for the same reason a sale keeps both: one is what the paperwork
  -- says and the other is what the reports add up.
  principal_amount   INTEGER NOT NULL,
  principal_currency TEXT NOT NULL DEFAULT 'AED',
  principal_fx_rate  INTEGER,
  principal_base     INTEGER NOT NULL,

  -- The monthly interest, as a rate and as the amount it comes to. The rate
  -- is the agreement — "two and a half percent a month" — and the amount is
  -- what gets charged; both are kept so a rate changed later never silently
  -- rewrites what was already billed.
  rate_bps           INTEGER NOT NULL,
  monthly_base       INTEGER NOT NULL,

  started_on         TIMESTAMPTZ NOT NULL,
  -- When it was due to be redeemed. Extensions move it.
  due_on             TIMESTAMPTZ,

  -- OPEN while it runs. REDEEMED when they pay the principal back and take
  -- the watches. DEFAULTED when they do not and the watches become ours.
  status             TEXT NOT NULL DEFAULT 'OPEN',
  closed_on          TIMESTAMPTZ,

  sold_by_id         TEXT REFERENCES sales_people(id) ON DELETE SET NULL,
  notes              TEXT,
  recorded_by_id     TEXT NOT NULL REFERENCES users(id),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS buybacks_status_idx ON buybacks (status, started_on);
CREATE INDEX IF NOT EXISTS buybacks_person_idx ON buybacks (sold_by_id, started_on);
CREATE INDEX IF NOT EXISTS buybacks_customer_idx ON buybacks (customer_id);

-- The watches securing the loan.
--
-- Described rather than referenced, because they are not ours: putting them
-- in `watches` would place somebody else's property in our stock, in the
-- capital-deployed figure and on the website. `watch_id` is filled in only
-- on default, when the watch does become ours and a stock record is created
-- for it at the loan value.
CREATE TABLE IF NOT EXISTS buyback_items (
  id           TEXT PRIMARY KEY,
  buyback_id   TEXT NOT NULL REFERENCES buybacks(id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  brand        TEXT,
  model        TEXT,
  serial       TEXT,
  year         INTEGER,
  -- What we valued this one at. The figures change with the watches
  -- securing them, so the valuation per item is worth keeping even though
  -- the loan is advanced as one sum.
  agreed_base  INTEGER,
  watch_id     TEXT REFERENCES watches(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS buyback_items_loan_idx ON buyback_items (buyback_id);

-- The money. One row per month of interest, plus extension fees.
CREATE TABLE IF NOT EXISTS buyback_charges (
  id             TEXT PRIMARY KEY,
  buyback_id     TEXT NOT NULL REFERENCES buybacks(id) ON DELETE CASCADE,
  -- INTEREST or EXTENSION.
  kind           TEXT NOT NULL,
  -- Which month of the loan this is: 1 for the first, 2 for the second.
  -- Null for an extension fee, which answers to no month.
  period_index   INTEGER,
  due_on         TIMESTAMPTZ NOT NULL,

  amount         INTEGER NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'AED',
  fx_rate        INTEGER,
  amount_base    INTEGER NOT NULL,

  payment_status TEXT NOT NULL DEFAULT 'PENDING',
  paid_on        TIMESTAMPTZ,

  voided_at      TIMESTAMPTZ,
  voided_by_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  void_reason    TEXT,
  notes          TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What makes accrual safe to run on every read.
--
-- Interest is added by working out which months have elapsed and inserting
-- the ones that are missing. Without this index, two requests landing in
-- the same moment both find month four missing and both write it, and the
-- customer is billed twice for the same month. With it, the second insert
-- is refused by the database rather than by a check that raced.
CREATE UNIQUE INDEX IF NOT EXISTS buyback_charge_period_idx
  ON buyback_charges (buyback_id, period_index)
  WHERE period_index IS NOT NULL AND voided_at IS NULL;

CREATE INDEX IF NOT EXISTS buyback_charges_loan_idx ON buyback_charges (buyback_id, due_on);
CREATE INDEX IF NOT EXISTS buyback_charges_due_idx ON buyback_charges (due_on);
