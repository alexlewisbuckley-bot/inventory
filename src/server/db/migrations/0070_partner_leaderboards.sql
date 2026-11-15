-- Leaderboard challenges a partner runs for its own people.
--
-- A third kind of campaign beside the shortlist and the budget: a company's
-- agents compete over a fixed run of weeks, their figures are entered once a
-- week, and the board shows who is on course for which prize. A prize is won
-- either by finishing position (1st, 2nd, 3rd) or by reaching a commission
-- target, and can be a watch, a cash amount or a voucher towards a watch.
--
-- Kept apart from partner_campaigns on purpose: those hand somebody a link to
-- choose a watch and take stock off the market. Nothing here holds stock or
-- places an order; a prize is a promise until somebody here invoices it.

CREATE TABLE IF NOT EXISTS partner_leaderboards (
  id text PRIMARY KEY,
  partner_id text NOT NULL REFERENCES partners (id) ON DELETE CASCADE,
  name text NOT NULL,
  intro text,
  -- What is being counted, in words, e.g. "Commission earned".
  metric_label text NOT NULL DEFAULT 'Commission earned',
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  -- The read-only link agents and an office screen use. Unguessable, and
  -- the only thing a public board is found by.
  share_token text NOT NULL,
  -- Whether the share link answers at all. Off until somebody decides the
  -- board is ready to be seen.
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_leaderboards_dates CHECK (ends_on >= starts_on)
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_leaderboards_share_idx ON partner_leaderboards (share_token);
CREATE INDEX IF NOT EXISTS partner_leaderboards_partner_idx ON partner_leaderboards (partner_id, starts_on);

CREATE TABLE IF NOT EXISTS partner_leaderboard_agents (
  id text PRIMARY KEY,
  leaderboard_id text NOT NULL REFERENCES partner_leaderboards (id) ON DELETE CASCADE,
  name text NOT NULL,
  -- A team, office or job title, shown under the name.
  subtitle text,
  photo_mime text,
  photo_data bytea,
  photo_byte_size integer,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partner_leaderboard_agents_board_idx
  ON partner_leaderboard_agents (leaderboard_id, sort_order);

CREATE TABLE IF NOT EXISTS partner_leaderboard_prizes (
  id text PRIMARY KEY,
  leaderboard_id text NOT NULL REFERENCES partner_leaderboards (id) ON DELETE CASCADE,
  name text NOT NULL,
  -- WATCH, CASH or VOUCHER.
  kind text NOT NULL DEFAULT 'WATCH',
  -- What it is worth, in base minor units. Optional for a watch.
  value_base integer,
  -- RANK: won by finishing in this position. TARGET: won by everybody whose
  -- running total reaches target_base.
  rule text NOT NULL DEFAULT 'RANK',
  rank integer,
  target_base integer,
  -- A watch from our own stock it refers to, where it is one.
  watch_id text REFERENCES watches (id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_leaderboard_prizes_rule CHECK (
    (rule = 'RANK' AND rank IS NOT NULL AND rank >= 1)
    OR (rule = 'TARGET' AND target_base IS NOT NULL AND target_base > 0)
  )
);

CREATE INDEX IF NOT EXISTS partner_leaderboard_prizes_board_idx
  ON partner_leaderboard_prizes (leaderboard_id, sort_order);

-- One row per agent per week. Entering a week again replaces it rather than
-- adding to it, so a corrected figure is a correction and not a double count.
CREATE TABLE IF NOT EXISTS partner_leaderboard_entries (
  id text PRIMARY KEY,
  leaderboard_id text NOT NULL REFERENCES partner_leaderboards (id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES partner_leaderboard_agents (id) ON DELETE CASCADE,
  -- The Monday the week starts on.
  week_start date NOT NULL,
  commission_base integer NOT NULL DEFAULT 0,
  deals integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_leaderboard_entries_week_idx
  ON partner_leaderboard_entries (agent_id, week_start);
CREATE INDEX IF NOT EXISTS partner_leaderboard_entries_board_idx
  ON partner_leaderboard_entries (leaderboard_id, week_start);
