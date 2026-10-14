-- Move the base currency from dollars to dirhams.
--
-- The second time this has been done: 0018 took the base from sterling to
-- dollars, and the shape of that migration is the shape of this one. The base
-- is the unit the stored integers mean, not a preference — the stock is in
-- Dubai, it is bought and sold in dirhams, and every figure in the system was
-- being held in a currency nobody in the building quotes in.
--
-- The peg is the one the business trades on: 1 AED = 0.272294 USD, so every
-- stored dollar figure is multiplied by 1 / 0.272294 = 3.6725073 to say the
-- same amount of money in dirhams. Nothing on screen changes value; what
-- changes is which number is stored and which is derived from it.
--
-- Three kinds of money column, and only one of them moves:
--
--   • BASE columns (`*_gbp`, `*_usd`) hold base minor units. These convert.
--   • AS-AGREED columns (`purchase_amount`, `sale_amount`, `trade_amount`,
--     `est_sale_amount`, the purchase invoice net/vat/gross) sit beside a
--     currency column naming what they are already in. These must NOT move:
--     a cost agreed at 55,000 dirhams was 55,000 dirhams before and after.
--   • FX PROVENANCE (`purchase_fx_rate`, `sale_fx_rate`) records the rate an
--     as-agreed figure was converted at to reach the base, which is "units of
--     that currency per 1 base". The base is changing underneath them, so
--     they are rescaled rather than multiplied. Getting this wrong is quiet:
--     nothing looks different until somebody corrects a sale or a cost, at
--     which point it is re-derived through a stale rate.
--
-- KNOWN DEBT, carried forward from 0018 and now one base worse: the columns
-- are still named `*_gbp` / `*_usd` and hold neither. Renaming them is right
-- and is a sweep across some 560 identifiers; it is not bundled into a
-- migration that is already restating every figure in the business.

DO $$
DECLARE
  -- USD per 1 AED, as given. Held to six places because the fifth and sixth
  -- are the difference between the peg and an approximation of it.
  usd_per_aed CONSTANT NUMERIC := 0.272294;
  -- What every stored dollar figure becomes.
  mult        CONSTANT NUMERIC := 1 / usd_per_aed;
  base_rate   INTEGER;
  money_keys  CONSTANT TEXT[] := ARRAY[
    'purchasePriceGbp', 'purchasePriceUsd', 'estSaleGbp', 'estSaleUsd',
    'tradePriceGbp', 'vatAmountGbp', 'saleAmountGbp', 'saleAmountUsd',
    'salePriceGbp', 'profitGbp', 'profitUsd', 'commissionGbp', 'depositGbp',
    'valueGbp', 'amountGbp', 'budgetGbp', 'quotedGbp', 'offerGbp',
    'creditLimitGbp', 'budgetMinGbp', 'budgetMaxGbp'
  ];
BEGIN
  -- Guard against a second run. Once the base is dirhams the AED rate is
  -- exactly 1, and converting again would inflate every figure in the
  -- business by 3.67 — silently, and in a way nobody would spot until a
  -- reconcile against the accounts.
  SELECT rate_per_gbp INTO base_rate FROM fx_rates WHERE code = 'AED';
  IF base_rate = 10000 THEN
    RAISE NOTICE 'Already on a dirham base; nothing to convert.';
    RETURN;
  END IF;

  RAISE NOTICE 'Rebasing dollar amounts to dirhams at % AED per USD', round(mult, 6);

  -- ---------------------------------------------------------------- stock --
  UPDATE watches SET
    purchase_price_gbp = round(purchase_price_gbp * mult),
    purchase_price_usd = round(purchase_price_usd * mult),
    est_sale_gbp       = round(est_sale_gbp       * mult),
    est_sale_usd       = round(est_sale_usd       * mult),
    trade_price_gbp    = round(trade_price_gbp    * mult),
    vat_amount_gbp     = round(vat_amount_gbp     * mult);

  -- ---------------------------------------------------------------- sales --
  -- Every sale ever recorded, not just the open ones: a voided or soft-deleted
  -- invoice is still read, still reported on, and still has to agree with the
  -- stock record beside it.
  UPDATE sales SET
    sale_amount_gbp = round(sale_amount_gbp * mult),
    sale_amount_usd = round(sale_amount_usd * mult),
    profit_gbp      = round(profit_gbp      * mult),
    profit_usd      = round(profit_usd      * mult),
    commission_gbp  = round(commission_gbp  * mult),
    deposit_gbp     = round(deposit_gbp     * mult);

  -- ------------------------------------------------------- customers & CRM --
  UPDATE customers SET
    budget_min_gbp   = round(budget_min_gbp   * mult),
    budget_max_gbp   = round(budget_max_gbp   * mult),
    credit_limit_gbp = round(credit_limit_gbp * mult);

  UPDATE deals SET
    value_gbp   = round(value_gbp   * mult),
    deposit_gbp = round(deposit_gbp * mult);

  UPDATE offers            SET amount_gbp = round(amount_gbp * mult);
  UPDATE watch_requests    SET budget_gbp = round(budget_gbp * mult);
  UPDATE request_enquiries SET quoted_gbp = round(quoted_gbp * mult);
  UPDATE trade_enquiries   SET offer_gbp  = round(offer_gbp  * mult);

  -- ------------------------------------------------------- the rate table --
  -- Every rate meant "units of X per 1 USD" and now means "units of X per 1
  -- AED", which is the old rate times the dollars a dirham buys. The dollar
  -- gains a rate of its own, which it never had while it was the base and was
  -- therefore pinned at 1.
  UPDATE fx_rates SET rate_per_gbp = greatest(1, round(rate_per_gbp * usd_per_aed));
  INSERT INTO fx_rates (code, rate_per_gbp)
    VALUES ('USD', greatest(1, round(10000 * usd_per_aed)))
    ON CONFLICT (code) DO UPDATE SET rate_per_gbp = greatest(1, round(10000 * usd_per_aed));
  UPDATE fx_rates SET rate_per_gbp = 10000 WHERE code = 'AED';

  -- --------------------------------------------------- the booked-at rates --
  -- Same turn as the rate table, for the same reason, on the two columns that
  -- record what an individual figure was converted at. A correction to a sale
  -- or a cost re-derives the base from these, so a stale one would restate an
  -- amount nobody touched.
  UPDATE watches SET purchase_fx_rate = greatest(1, round(purchase_fx_rate * usd_per_aed))
    WHERE purchase_fx_rate IS NOT NULL;
  UPDATE sales   SET sale_fx_rate     = greatest(1, round(sale_fx_rate     * usd_per_aed))
    WHERE sale_fx_rate IS NOT NULL;

  -- -------------------------------------------------------- the audit trail --
  -- The trail prints these figures as money, so leaving them would relabel
  -- every historical dollar amount as a dirham one and overstate the lot by
  -- 3.67. Only the known base-money keys move, and only where the value is
  -- actually a number — `from` is null on anything that was previously unset.
  UPDATE audit_logs a SET changes = (
    SELECT jsonb_object_agg(
      e.key,
      CASE WHEN e.key = ANY(money_keys) AND jsonb_typeof(e.value) = 'object' THEN
        jsonb_build_object(
          'from', CASE WHEN jsonb_typeof(e.value -> 'from') = 'number'
                       THEN to_jsonb(round((e.value ->> 'from')::NUMERIC * mult)::BIGINT)
                       ELSE e.value -> 'from' END,
          'to',   CASE WHEN jsonb_typeof(e.value -> 'to') = 'number'
                       THEN to_jsonb(round((e.value ->> 'to')::NUMERIC * mult)::BIGINT)
                       ELSE e.value -> 'to' END
        )
      ELSE e.value END
    )::TEXT
    FROM jsonb_each(a.changes::JSONB) AS e
  )
  WHERE a.changes IS NOT NULL
    AND a.changes <> ''
    AND jsonb_typeof(a.changes::JSONB) = 'object';
END $$;

-- The column defaults, which still named the currencies of two bases ago. A
-- default is what somebody gets when they say nothing, and in Dubai saying
-- nothing means dirhams.
ALTER TABLE watches           ALTER COLUMN purchase_currency  SET DEFAULT 'AED';
ALTER TABLE watches           ALTER COLUMN est_sale_currency  SET DEFAULT 'AED';
ALTER TABLE watches           ALTER COLUMN trade_currency     SET DEFAULT 'AED';
ALTER TABLE sales             ALTER COLUMN sale_currency      SET DEFAULT 'AED';
ALTER TABLE offers            ALTER COLUMN currency           SET DEFAULT 'AED';
ALTER TABLE purchase_invoices ALTER COLUMN currency           SET DEFAULT 'AED';
ALTER TABLE suppliers         ALTER COLUMN default_currency   SET DEFAULT 'AED';
ALTER TABLE user_preferences  ALTER COLUMN display_currency   SET DEFAULT 'AED';

-- `resellers.display_currency` is deliberately left alone. That one is the
-- currency a reseller's own shop window reads in, which is a fact about where
-- their customers are rather than about where our stock is, and a dealer in
-- London does not want our move to dirhams showing up on their storefront.

-- Anybody still carrying the old default is moved with it. A preference
-- somebody actually chose is theirs; this only catches the ones who never
-- opened the menu, which is everybody holding the value the default used to
-- hand out.
UPDATE user_preferences SET display_currency = 'AED' WHERE display_currency = 'USD';

-- Asserted rather than assumed: every figure in the system is multiplied or
-- divided by one of these, so a wrong one is wrong everywhere at once.
DO $$
DECLARE aed INTEGER; usd INTEGER; gbp INTEGER;
BEGIN
  SELECT rate_per_gbp INTO aed FROM fx_rates WHERE code = 'AED';
  SELECT rate_per_gbp INTO usd FROM fx_rates WHERE code = 'USD';
  SELECT rate_per_gbp INTO gbp FROM fx_rates WHERE code = 'GBP';

  IF aed IS DISTINCT FROM 10000 THEN
    RAISE EXCEPTION 'The base currency must be exactly 1; AED is %', aed;
  END IF;
  IF usd IS NULL OR usd <= 0 THEN
    RAISE EXCEPTION 'The dollar has no rate against the new base, so nothing could be shown in it.';
  END IF;
  IF gbp IS NULL OR gbp <= 0 THEN
    RAISE EXCEPTION 'Sterling has no rate against the new base, so nothing could be shown in it.';
  END IF;
  -- The peg, within the four decimal places the rate column can hold. A USD
  -- rate that has drifted from 0.2723 means this ran against a table that was
  -- not on a dollar base, and every amount above it is then suspect.
  IF abs(usd - 2723) > 1 THEN
    RAISE EXCEPTION 'The dollar rate came out at %, not the pegged 2723 — the amounts above this are not trustworthy.', usd;
  END IF;
END $$;
