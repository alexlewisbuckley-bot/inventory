-- Nor is America.
--
-- Alex, a day after the same request about Hong Kong: "Also make USA not
-- shown in default."
--
-- Same judgement as 0066, same reason for making it here rather than leaving
-- it to be ticked: the decision was already made in the sentence that
-- started all of this — "ALL EXCEPT IN TRANSIT AND OVERSEAS FOR EXAMPLE HONG
-- KONG" — and America is overseas from a Dubai shop by any reading of it.
--
-- Matched on whole words, so a location that merely contains those letters
-- is left alone. The name and the country are both checked because the
-- country column is blank on most rows and a location called "USA Vault"
-- says it plainly enough without one.
UPDATE locations
SET is_on_hand = false
WHERE name ~* '(^|[^a-z])(usa|u\.?s\.?a\.?|united states|america|american)([^a-z]|$)'
   OR coalesce(country, '') ~* '(^|[^a-z])(usa|u\.?s\.?a\.?|united states|america)([^a-z]|$)';
