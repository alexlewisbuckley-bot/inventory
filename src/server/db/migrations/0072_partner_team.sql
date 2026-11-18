-- A partner's own team, kept once and drawn on by every leaderboard.
--
-- Alex: let them add their agents and the agents' photos in settings, so a
-- new leaderboard is a matter of ticking who is in it — or all of them —
-- rather than typing the same names and uploading the same faces each time.
--
-- A leaderboard still keeps its own copy of each agent it takes. A board is a
-- record of a competition that happened; somebody leaving the team, or
-- changing their photo next year, must not rewrite last quarter's results.
-- The link back is kept so a board knows who it already has.

CREATE TABLE IF NOT EXISTS partner_agents (
  id text PRIMARY KEY,
  partner_id text NOT NULL REFERENCES partners (id) ON DELETE CASCADE,
  name text NOT NULL,
  subtitle text,
  photo_mime text,
  photo_data bytea,
  photo_byte_size integer,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partner_agents_partner_idx ON partner_agents (partner_id, sort_order);

ALTER TABLE partner_leaderboard_agents
  ADD COLUMN IF NOT EXISTS partner_agent_id text REFERENCES partner_agents (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS partner_leaderboard_agents_member_idx
  ON partner_leaderboard_agents (leaderboard_id, partner_agent_id) WHERE partner_agent_id IS NOT NULL;
