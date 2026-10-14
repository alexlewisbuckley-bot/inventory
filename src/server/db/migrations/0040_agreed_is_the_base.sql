-- An amount agreed in the base currency IS the base amount.
--
-- A cost entered as AED 69,000 was coming back as AED 69,062. Not rounding —
-- sixty-two dirhams on sixty-nine thousand is nine parts in ten thousand,
-- which is far too much to be a half-unit anywhere. It is the gap between two
-- rates:
--
--   AED 69,000 was entered while the base was the dollar, and converted at the
--   rate the table then held — 3.6688 — to $18,807.37. Migration 0038 brought
--   it back at the peg it was given, 3.6725010. The two rates differ in the
--   third decimal place, and the difference is the sixty-two dirhams.
--
-- Every amount struck in dirhams before the rebase carries this. Amounts
-- struck in dollars do not: the dollar was the base, so 0038 converted them
-- once, directly, with nothing to disagree with.
--
-- The repair is exact rather than approximate, and that is the whole reason
-- 0038 was careful to leave the as-agreed columns alone. `purchase_amount`
-- still holds 6900000 and `purchase_currency` still says AED. When the agreed
-- currency IS the base there is no conversion to perform and no rate to
-- disagree about: the base column must equal the agreed column, exactly.
--
-- Idempotent by construction — it sets a column equal to another column — so
-- running it twice changes nothing, and it cannot touch a row agreed in any
-- other currency.

DO $$
DECLARE
  base      CONSTANT TEXT := 'AED';
  base_rate CONSTANT INTEGER := 10000;
  fixed     INTEGER;
BEGIN
  -- ------------------------------------------------------------- the cost --
  UPDATE watches SET
    purchase_price_gbp = purchase_amount,
    purchase_price_usd = purchase_amount,
    -- The rate an amount was converted at to reach the base is 1 when the two
    -- are the same currency. Left stale, a later correction to this cost would
    -- re-derive it through the old dollar rate and reintroduce the drift this
    -- migration exists to remove.
    purchase_fx_rate   = base_rate
  WHERE purchase_currency = base
    AND purchase_amount IS NOT NULL
    AND purchase_price_gbp IS DISTINCT FROM purchase_amount;
  GET DIAGNOSTICS fixed = ROW_COUNT;
  RAISE NOTICE 'costs restored to the figure agreed: %', fixed;

  -- ----------------------------------------------------- retail and trade --
  UPDATE watches SET
    est_sale_gbp = est_sale_amount,
    est_sale_usd = est_sale_amount
  WHERE est_sale_currency = base
    AND est_sale_amount IS NOT NULL
    AND est_sale_gbp IS DISTINCT FROM est_sale_amount;
  GET DIAGNOSTICS fixed = ROW_COUNT;
  RAISE NOTICE 'retail prices restored: %', fixed;

  UPDATE watches SET trade_price_gbp = trade_amount
  WHERE trade_currency = base
    AND trade_amount IS NOT NULL
    AND trade_price_gbp IS DISTINCT FROM trade_amount;
  GET DIAGNOSTICS fixed = ROW_COUNT;
  RAISE NOTICE 'trade prices restored: %', fixed;

  -- ---------------------------------------------------------- what was sold --
  UPDATE sales SET
    sale_amount_gbp = sale_amount,
    sale_amount_usd = sale_amount,
    sale_fx_rate    = base_rate
  WHERE sale_currency = base
    AND sale_amount IS NOT NULL
    AND sale_amount_gbp IS DISTINCT FROM sale_amount;
  GET DIAGNOSTICS fixed = ROW_COUNT;
  RAISE NOTICE 'sale prices restored: %', fixed;

  UPDATE offers SET amount_gbp = amount
  WHERE currency = base AND amount_gbp IS DISTINCT FROM amount;
  GET DIAGNOSTICS fixed = ROW_COUNT;
  RAISE NOTICE 'offers restored: %', fixed;

  -- ------------------------------------------------- profit, which follows --
  -- Profit and margin are stored against the sale so reports can total them
  -- without joining back to stock. Both derive from two figures that may just
  -- have moved, so they are recomputed from the pair as it now stands rather
  -- than nudged — the same obligation the application carries whenever either
  -- side is corrected.
  UPDATE sales s SET
    profit_gbp = s.sale_amount_gbp - w.purchase_price_gbp,
    profit_usd = s.sale_amount_gbp - w.purchase_price_gbp,
    margin_bps = CASE
      WHEN w.purchase_price_gbp > 0
        THEN round(((s.sale_amount_gbp - w.purchase_price_gbp)::NUMERIC / w.purchase_price_gbp) * 10000)
      ELSE 0
    END
  FROM watches w
  WHERE w.id = s.watch_id
    AND (
      s.profit_gbp IS DISTINCT FROM s.sale_amount_gbp - w.purchase_price_gbp
      OR s.margin_bps IS DISTINCT FROM CASE
        WHEN w.purchase_price_gbp > 0
          THEN round(((s.sale_amount_gbp - w.purchase_price_gbp)::NUMERIC / w.purchase_price_gbp) * 10000)
        ELSE 0
      END
    );
  GET DIAGNOSTICS fixed = ROW_COUNT;
  RAISE NOTICE 'profits recomputed: %', fixed;
END $$;

-- Asserted rather than assumed: not one amount agreed in the base may differ
-- from its base column after this, because the two are the same number.
DO $$
DECLARE bad INTEGER;
BEGIN
  SELECT count(*) INTO bad FROM watches
   WHERE purchase_currency = 'AED' AND purchase_amount IS NOT NULL
     AND purchase_price_gbp IS DISTINCT FROM purchase_amount;
  IF bad > 0 THEN
    RAISE EXCEPTION '% costs still differ from the figure that was agreed.', bad;
  END IF;

  SELECT count(*) INTO bad FROM sales
   WHERE sale_currency = 'AED' AND sale_amount IS NOT NULL
     AND sale_amount_gbp IS DISTINCT FROM sale_amount;
  IF bad > 0 THEN
    RAISE EXCEPTION '% sale prices still differ from the figure that was agreed.', bad;
  END IF;
END $$;
