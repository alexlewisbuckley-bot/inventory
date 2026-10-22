-- Read figures in dirhams, not dollars.
--
-- Every amount was rebased to AED in 0038 and DEFAULT_DISPLAY_CURRENCY was
-- moved with it, but the column default was not: it still said 'USD'. So a
-- preferences row created by the database rather than by somebody choosing
-- came out in dollars, and the reports quietly rendered a Dubai business's
-- figures in a currency nobody there works in. The Sales-by-person report
-- showed "$152,936" against a book kept in dirhams.
--
-- Existing rows are moved too. A row saying USD here is almost certainly
-- the old default rather than a decision — the application has defaulted to
-- AED everywhere else since 0038 — and leaving them would fix the problem
-- only for accounts created from today. Anybody who does want dollars sets
-- it back in Settings → Profile, which is one control and rewrites nothing:
-- the figures are stored in base units and converted at render.

ALTER TABLE user_preferences ALTER COLUMN display_currency SET DEFAULT 'AED';
UPDATE user_preferences SET display_currency = 'AED' WHERE display_currency = 'USD';

-- A reseller's shop quotes their customers, who are not necessarily in the
-- Emirates — so the default moves for consistency with the base currency,
-- but existing shops are left exactly as they were configured.
ALTER TABLE resellers ALTER COLUMN display_currency SET DEFAULT 'AED';
