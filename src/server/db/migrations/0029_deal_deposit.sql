-- What has actually been paid, as against what was agreed.
--
-- A deal carried one figure, `value_gbp`, which is the price agreed. That is
-- the number for a forecast and the wrong number for the question somebody
-- asks at the counter: how much is still owed on this one. A watch goes on
-- hold, then a deposit is taken, then it is sold — and between the second and
-- the third there is a balance, which was being worked out on paper or not at
-- all.
--
-- Nullable, because a deal with nothing paid against it is the normal state
-- and a zero would read as "they paid nothing" rather than "nobody has asked
-- them to yet".
ALTER TABLE deals ADD COLUMN deposit_gbp INTEGER;

-- The one read: deals with money against them, for chasing a balance.
CREATE INDEX deals_deposit_idx ON deals (deposit_gbp) WHERE deposit_gbp IS NOT NULL;
