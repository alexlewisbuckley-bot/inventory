-- Put every asking price back on a round number.
--
-- Eleven live listings carried fils, all of them residue from the dollar
-- era. Ten were round dollar prices that the rebase converted correctly and
-- uselessly — $20,000 is AED 73,450.02, $45,000 is AED 165,262.55 — and one,
-- stock 1526, was a dirham price that went out to dollars and came back a
-- single fil short of AED 74,750. A shop window reading "Dhs. 74,749.99"
-- looks like a mistake whichever way it got there.
--
-- Asking prices now sit on a AED 250 ladder, rounded up: see `askingPrice`
-- in src/lib/money.ts, which is applied wherever a retail price is written,
-- so this is a one-off repair rather than a recurring cleanup.
--
-- Retail only. The purchase price is what was actually paid and a sale is
-- what was actually agreed — rounding either would invent a figure that no
-- invoice says. The trade price is left alone too: it is quoted to one
-- dealer at a time rather than published, and nobody asked for it.

DO $$
DECLARE
  step   CONSTANT BIGINT := 25000;  -- AED 250 in fils
  moved  INTEGER;
BEGIN
  -- Stock still for sale only. A watch that has gone has an asking price
  -- that is now a matter of record: what we were asking when it sold.
  UPDATE watches
  SET est_sale_gbp = ceil(est_sale_gbp::NUMERIC / step) * step,
      est_sale_usd = ceil(est_sale_gbp::NUMERIC / step) * step,
      -- Kept in step only where the two are the same number by definition.
      -- A watch priced in dollars holds the dollar figure somebody typed,
      -- and that is still what they typed.
      est_sale_amount = CASE
        WHEN est_sale_currency = 'AED' THEN ceil(est_sale_gbp::NUMERIC / step) * step
        ELSE est_sale_amount
      END
  WHERE deleted_at IS NULL
    AND status <> 'SOLD'
    AND est_sale_gbp IS NOT NULL
    AND est_sale_gbp > 0
    AND est_sale_gbp % step <> 0;

  GET DIAGNOSTICS moved = ROW_COUNT;
  RAISE NOTICE 'Rounded % asking price(s) up onto the AED 250 ladder.', moved;

  -- Nothing may be left off the ladder, and nothing may have been rounded
  -- down: an asking price that quietly fell is the one outcome worse than
  -- an untidy one.
  IF EXISTS (
    SELECT 1 FROM watches
    WHERE deleted_at IS NULL AND status <> 'SOLD'
      AND est_sale_gbp IS NOT NULL AND est_sale_gbp > 0
      AND est_sale_gbp % step <> 0
  ) THEN
    RAISE EXCEPTION 'An asking price is still off the AED 250 ladder.';
  END IF;
END $$;
