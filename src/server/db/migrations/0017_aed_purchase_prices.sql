-- Restate 22 purchases at what they actually cost, in dirhams.
--
-- A data correction rather than a schema change, done here because a
-- migration is the only reviewable thing in this repository that reaches
-- production on its own, and because purchase prices are the figures every
-- margin, profit and capital number is derived from. Doing it by hand
-- twenty-two times is how one of them ends up with a digit missing.
--
-- Matched on serial number, which is unique to a watch. The one row without a
-- serial is matched on its reference and the absence of one, and there is
-- exactly one such watch; if production holds two, it updates neither rather
-- than guessing, because the wrong watch repriced is worse than none.
--
-- The arithmetic mirrors what the intake form does, deliberately and to the
-- rounding:
--   purchase_amount     the dirham figure, in minor units, as agreed
--   purchase_currency   AED, so the record says what was actually paid
--   purchase_price_gbp  converted through the stored AED rate, because
--                       sterling minor units are the base every report reads
--   purchase_price_usd  derived from that at the configured GBP→USD rate
--   purchase_fx_rate    that rate, captured against the purchase
--
-- Rates are read from the database rather than written in, so this produces
-- the same numbers the application would have produced had somebody typed
-- each one into the form.

DO $$
DECLARE
  aed_per_gbp   NUMERIC;
  gbp_usd       NUMERIC;
  bought_on     TIMESTAMPTZ := TIMESTAMPTZ '2026-09-20 12:00:00+00';
  touched       INTEGER;
BEGIN
  SELECT rate_per_gbp / 10000.0 INTO aed_per_gbp FROM fx_rates WHERE code = 'AED';
  IF aed_per_gbp IS NULL OR aed_per_gbp <= 0 THEN
    RAISE EXCEPTION 'No AED rate is set, so dirham purchases cannot be converted to the sterling base.';
  END IF;

  SELECT value::NUMERIC INTO gbp_usd FROM app_settings WHERE key = 'finance.fxGbpUsd';
  IF gbp_usd IS NULL OR gbp_usd <= 0 THEN gbp_usd := 1.33; END IF;

  CREATE TEMP TABLE repriced (serial TEXT, reference TEXT, aed NUMERIC) ON COMMIT DROP;
  INSERT INTO repriced (serial, reference, aed) VALUES
    ('0SQ84951', '116334',     35350),
    (NULL,       '116518NG',  150000),
    ('1398',     '69173G',     19350),
    ('7416L8L7', '178341',     44850),
    ('Z114098',  '179163',     24300),
    ('S7353018', '179383',     39250),
    ('89M1R777', '116610LV',   66450),
    ('51D78517', '326933',     58750),
    ('5S888313', '126621',     48600),
    ('947EQ484', '216570',     28900),
    ('03M71142', '126610LV',   49600),
    ('620091Z3', '326934',     66900),
    ('7C813481', '126333',     46800),
    ('033C5777', '126200',     33700),
    ('78RG7983', '126300',     31300),
    ('E9C99384', '126331',     54850),
    ('DU048221', '126334',     45250),
    ('481Y77U9', '126613LN',   56800),
    ('101VD382', '126660',     42350),
    ('1T41F071', '126711CHNR', 66400),
    ('G590653',  '179174',     22400),
    ('G472253',  '179383',     38500);

  -- Recorded before the change, so the audit line can say what it was.
  CREATE TEMP TABLE before_change ON COMMIT DROP AS
  SELECT w.id, w.stock_no, w.purchase_price_gbp AS was_gbp, r.aed
  FROM watches w
  JOIN repriced r
    ON (r.serial IS NOT NULL AND w.serial = r.serial)
    OR (r.serial IS NULL AND w.serial IS NULL AND w.model = r.reference
        AND (SELECT count(*) FROM watches w2
             WHERE w2.model = r.reference AND w2.serial IS NULL AND w2.deleted_at IS NULL) = 1)
  WHERE w.deleted_at IS NULL;

  UPDATE watches w SET
    purchase_date      = bought_on,
    purchase_amount    = round(b.aed * 100),
    purchase_currency  = 'AED',
    purchase_price_gbp = round(b.aed * 100 / aed_per_gbp),
    purchase_price_usd = round(round(b.aed * 100 / aed_per_gbp) * gbp_usd),
    purchase_fx_rate   = round(gbp_usd * 10000),
    updated_at         = now(),
    version            = w.version + 1
  FROM before_change b
  WHERE w.id = b.id;

  GET DIAGNOSTICS touched = ROW_COUNT;
  RAISE NOTICE 'Repriced % of 22 watches in AED at %/GBP', touched, aed_per_gbp;

  -- All twenty-two or none. This was verified against a database holding every
  -- one of these serials; if production holds fewer, the honest outcome is a
  -- build that stops and says so, not a price list where fourteen rows were
  -- restated and eight were quietly left at the old figure. A failed migration
  -- leaves the previous deployment serving and the data untouched, which is
  -- recoverable. Half-applied accounts are not.
  IF touched <> 22 THEN
    RAISE EXCEPTION
      'Expected to reprice 22 watches but matched %. No prices have been changed. '
      'The serials in this migration do not all exist here — check them against the '
      'stock list before re-running.', touched;
  END IF;

  -- Audited, because everything else in this system is. A bulk rewrite of the
  -- numbers the accounts are built on is precisely what somebody would want to
  -- be able to trace later, and the old figure is kept so it can be undone.
  INSERT INTO audit_logs (id, entity_type, entity_id, action, summary, actor_id, changes, created_at)
  SELECT
    'aud_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS') || substr(md5(random()::text), 1, 8),
    'Watch', b.id, 'UPDATE',
    'Stock ' || b.stock_no || ' repriced to AED ' || to_char(b.aed, 'FM999,999,990'),
    (SELECT id FROM users WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1),
    json_build_object('purchasePriceGbp', json_build_object(
      'from', b.was_gbp, 'to', round(b.aed * 100 / aed_per_gbp)))::text,
    now()
  FROM before_change b;
END $$;
