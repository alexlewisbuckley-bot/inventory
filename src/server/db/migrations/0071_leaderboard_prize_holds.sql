-- Watch prizes come from stock and are held for the client; challenges launch.
--
-- Alex: to run a leaderboard the company MUST choose the watches or vouchers
-- it is buying before it starts, and a watch prize is reserved out of the
-- stock that is actually available, held for the client like any other
-- partner order. So a prize can now point at the order holding its watch,
-- and a challenge records when it was launched — the moment its prizes were
-- settled and figures could start going in.

ALTER TABLE partner_leaderboard_prizes
  ADD COLUMN IF NOT EXISTS order_id text REFERENCES partner_orders (id) ON DELETE SET NULL;

ALTER TABLE partner_leaderboards
  ADD COLUMN IF NOT EXISTS launched_at timestamptz;
