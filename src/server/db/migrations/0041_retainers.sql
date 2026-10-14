-- What each salesperson is paid, and what they earn on top of it.
--
-- A retainer every month, and a share of the profit on their own sales above
-- it. "Their own" is the load-bearing word: the threshold is cleared by the
-- profit on the sales with their name on, not by the business doing well.
--
-- Both figures sit on the person rather than in a settings row, because they
-- are negotiated one at a time — the rate is the same twenty-five per cent
-- for everybody today and will not be the day somebody is promoted, and a
-- single shared number is the kind of thing that gets changed for one person
-- and silently repays six.

-- Base minor units, like every other amount in the system: dirham fils.
ALTER TABLE sales_people ADD COLUMN IF NOT EXISTS retainer INTEGER NOT NULL DEFAULT 0;

-- Basis points, so a quarter share is 2500 and an eighth is 1250 with nothing
-- rounded away. Percent as an integer would make 12.5% unrepresentable, and
-- a float would make two people on the same rate disagree in the last fils.
ALTER TABLE sales_people ADD COLUMN IF NOT EXISTS commission_bps INTEGER NOT NULL DEFAULT 2500;
