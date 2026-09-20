-- Move the base currency from sterling to dollars.
--
-- Not a display change — that was 0015, and it was the wrong answer to the
-- question that was asked. This is the unit the stored integers actually mean.
-- Every money column held GBP minor units and now holds USD minor units, and
-- the exchange table that meant "units of X per 1 GBP" now means "units of X
-- per 1 USD".
--
-- Converted at the GBP→USD rate the application already holds, so every figure
-- moves by exactly the factor the screens were applying in order to display
-- it. Nothing on screen changes value. What changes is which number is stored
-- and which one is derived from it.
--
-- KNOWN DEBT, deliberately left: the columns are still named `*_gbp` and the
-- rate column is still `rate_per_gbp`, while all of them now hold dollars.
-- Renaming them is the right thing and is not done here only because it forces
-- a matching rename of some 560 identifiers across 59 source files, which
-- could not be applied in one pass in this environment. The names are the lie;
-- the values are correct. See the note in `src/lib/currency.ts`.

DO $$
DECLARE
  usd_per_gbp NUMERIC;
  base_rate   INTEGER;
BEGIN
  SELECT value::NUMERIC INTO usd_per_gbp FROM app_settings WHERE key = 'finance.fxGbpUsd';
  IF usd_per_gbp IS NULL OR usd_per_gbp <= 0 THEN usd_per_gbp := 1.33; END IF;

  -- Guard against a second run. Once the base is dollars the USD rate is
  -- exactly 1, and converting again would inflate every figure in the business
  -- by a third — silently, and in a way nobody would spot until a reconcile.
  SELECT rate_per_gbp INTO base_rate FROM fx_rates WHERE code = 'USD';
  IF base_rate = 10000 THEN
    RAISE NOTICE 'Already on a dollar base; nothing to convert.';
    RETURN;
  END IF;

  RAISE NOTICE 'Rebasing sterling amounts to dollars at %', usd_per_gbp;

  UPDATE watches SET
    purchase_price_gbp = round(purchase_price_gbp * usd_per_gbp),
    est_sale_gbp       = round(est_sale_gbp * usd_per_gbp),
    vat_amount_gbp     = round(vat_amount_gbp * usd_per_gbp);

  UPDATE sales SET
    sale_amount_gbp    = round(sale_amount_gbp * usd_per_gbp),
    profit_gbp         = round(profit_gbp * usd_per_gbp),
    commission_gbp     = round(commission_gbp * usd_per_gbp),
    deposit_gbp        = round(deposit_gbp * usd_per_gbp);

  UPDATE customers SET
    budget_min_gbp     = round(budget_min_gbp * usd_per_gbp),
    budget_max_gbp     = round(budget_max_gbp * usd_per_gbp),
    credit_limit_gbp   = round(credit_limit_gbp * usd_per_gbp);

  UPDATE deals             SET value_gbp  = round(value_gbp * usd_per_gbp);
  UPDATE offers            SET amount_gbp = round(amount_gbp * usd_per_gbp);
  UPDATE watch_requests    SET budget_gbp = round(budget_gbp * usd_per_gbp);
  UPDATE request_enquiries SET quoted_gbp = round(quoted_gbp * usd_per_gbp);

  -- The rate table, turned around: every rate was per pound and is now per
  -- dollar. Sterling gains a rate of its own, which it never had while it was
  -- the base and was therefore pinned at 1.
  UPDATE fx_rates SET rate_per_gbp = greatest(1, round(rate_per_gbp / usd_per_gbp));
  INSERT INTO fx_rates (code, rate_per_gbp)
    VALUES ('GBP', greatest(1, round(10000 / usd_per_gbp)))
    ON CONFLICT (code) DO UPDATE SET rate_per_gbp = greatest(1, round(10000 / usd_per_gbp));
  UPDATE fx_rates SET rate_per_gbp = 10000 WHERE code = 'USD';
END $$;

-- Asserted rather than assumed: every figure in the system is divided by one
-- of these two, so a wrong one is wrong everywhere at once.
DO $$
DECLARE usd INTEGER; gbp INTEGER;
BEGIN
  SELECT rate_per_gbp INTO usd FROM fx_rates WHERE code = 'USD';
  SELECT rate_per_gbp INTO gbp FROM fx_rates WHERE code = 'GBP';
  IF usd IS DISTINCT FROM 10000 THEN
    RAISE EXCEPTION 'The base currency must be exactly 1; USD is %', usd;
  END IF;
  IF gbp IS NULL OR gbp <= 0 THEN
    RAISE EXCEPTION 'Sterling has no rate against the new base, so nothing could be shown in it.';
  END IF;
END $$;
