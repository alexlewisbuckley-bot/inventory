-- The business reads its own numbers in dollars.
--
-- A display change, not a re-denomination. Every amount is still stored in
-- sterling minor units, because that is what the purchase invoices, the VAT
-- and the margin scheme are denominated in; this only changes the currency
-- those stored figures are converted into on the way to the screen. Switching
-- it back is one setting per person, and rewrites nothing.
--
-- Existing rows are moved as well as the default. Every one of them says GBP
-- because that is what the default was, which is indistinguishable from a
-- deliberate choice — but nobody has been offered the alternative until now,
-- so treating them as unset is the reading that matches what actually
-- happened. Anybody who wants sterling back can set it in their profile.
ALTER TABLE user_preferences ALTER COLUMN display_currency SET DEFAULT 'USD';

UPDATE user_preferences SET display_currency = 'USD' WHERE display_currency = 'GBP';

-- The rate that conversion now depends on for every screen, rather than only
-- for the ones somebody had switched. Inserted only if it is missing: a rate
-- already set by hand is a deliberate figure and must not be overwritten by a
-- migration. 1.33 is a placeholder to be corrected in Settings → Currencies.
INSERT INTO fx_rates (code, rate_per_gbp)
VALUES ('USD', 13300)
ON CONFLICT (code) DO NOTHING;
