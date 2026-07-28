-- 0002_currencies — multi-currency support.
--
-- GBP is the base currency: every amount is stored in GBP minor units so that
-- totals, margins and reports are computed on one consistent scale. Alongside
-- the base we keep the amount and currency the user actually entered, so a
-- purchase agreed in AED still displays as the AED figure that was signed for,
-- rather than a GBP round-trip that drifts as rates move.

CREATE TABLE fx_rates (
  code          TEXT PRIMARY KEY,
  -- Units of `code` per 1 GBP, stored as an integer x10000 to avoid floats.
  -- GBP itself is 10000.
  rate_per_gbp  INTEGER     NOT NULL CHECK (rate_per_gbp > 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_id TEXT REFERENCES users (id) ON DELETE SET NULL
);

INSERT INTO fx_rates (code, rate_per_gbp) VALUES
  ('GBP', 10000),
  ('USD', 13300),
  ('AED', 48800),
  ('HKD', 103000);

-- What the user entered, preserved alongside the GBP base amount.
ALTER TABLE watches ADD COLUMN purchase_currency TEXT    NOT NULL DEFAULT 'GBP';
ALTER TABLE watches ADD COLUMN purchase_amount   INTEGER;
ALTER TABLE watches ADD COLUMN est_sale_currency TEXT    NOT NULL DEFAULT 'USD';
ALTER TABLE watches ADD COLUMN est_sale_amount   INTEGER;
ALTER TABLE watches ADD COLUMN est_sale_gbp      INTEGER;

-- Existing rows: purchases were recorded in GBP, estimates in USD.
UPDATE watches SET purchase_amount = purchase_price_gbp WHERE purchase_amount IS NULL;
UPDATE watches SET est_sale_amount = est_sale_usd WHERE est_sale_amount IS NULL;
UPDATE watches
   SET est_sale_gbp = ROUND(est_sale_usd::numeric * 10000 / 13300)
 WHERE est_sale_usd IS NOT NULL AND est_sale_gbp IS NULL;

ALTER TABLE sales ADD COLUMN sale_currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE sales ADD COLUMN sale_amount   INTEGER;
UPDATE sales SET sale_amount = sale_amount_usd WHERE sale_amount IS NULL;

CREATE INDEX watches_est_sale_gbp_idx ON watches (est_sale_gbp);
