-- Agents, their targets, and where they have got to.
--
-- Alex: "I would like it to be a place the company can add their agents to
-- the portal and assign a goal against them or a target that is tracked and
-- obtained against the prize of their choice / wishlist - for example the
-- agent if x Million AED earnt unlocks x incetive or watch."
--
-- A campaign and a programme look alike and are not. A campaign is one
-- moment: here are some watches, pick one, done. A programme is a year — a
-- figure to reach, a thing waiting at the end of it, and a number that moves
-- every month in between. The progress table is the difference, and
-- everything else follows from it.

CREATE TABLE IF NOT EXISTS partner_agents (
  id            text PRIMARY KEY,
  partner_id    text NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  name          text NOT NULL,
  email         text,
  token         text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_agents_token_idx ON partner_agents (token);
CREATE INDEX IF NOT EXISTS partner_agents_partner_idx ON partner_agents (partner_id, name);

CREATE TABLE IF NOT EXISTS partner_programmes (
  id            text PRIMARY KEY,
  partner_id    text NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  name          text NOT NULL,
  kind          text NOT NULL DEFAULT 'LADDER',
  intro         text,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  status        text NOT NULL DEFAULT 'DRAFT',
  opened_at     timestamptz,
  closed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS partner_programmes_partner_idx ON partner_programmes (partner_id, created_at);

-- One rung: reach this much, choose up to that. A SINGLE programme has one
-- row here and it is the whole scheme, so the agent's page reads the same
-- shape either way and a company adding rungs next year adds rows.
CREATE TABLE IF NOT EXISTS partner_programme_tiers (
  id              text PRIMARY KEY,
  programme_id    text NOT NULL REFERENCES partner_programmes(id) ON DELETE CASCADE,
  label           text NOT NULL,
  threshold_base  integer NOT NULL,
  reward_cap_base integer NOT NULL,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_programme_tiers_programme_idx
  ON partner_programme_tiers (programme_id, threshold_base);

-- The target sits here rather than on the programme because a SINGLE
-- programme gives everybody a different number, which is the point of it.
CREATE TABLE IF NOT EXISTS partner_agent_goals (
  id              text PRIMARY KEY,
  programme_id    text NOT NULL REFERENCES partner_programmes(id) ON DELETE CASCADE,
  agent_id        text NOT NULL REFERENCES partner_agents(id) ON DELETE CASCADE,
  target_base     integer,
  picked_watch_id text REFERENCES watches(id) ON DELETE SET NULL,
  picked_note     text,
  picked_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_agent_goals_unique_idx
  ON partner_agent_goals (programme_id, agent_id);
CREATE INDEX IF NOT EXISTS partner_agent_goals_agent_idx ON partner_agent_goals (agent_id);

-- A log, not a column. A single number somebody overwrites every month
-- answers "where are they now" and nothing else: not whether it has moved
-- since August, not who said so, and not whether a figure that fell was a
-- correction or a bad quarter. The current figure is the newest row.
CREATE TABLE IF NOT EXISTS partner_agent_progress (
  id               text PRIMARY KEY,
  goal_id          text NOT NULL REFERENCES partner_agent_goals(id) ON DELETE CASCADE,
  as_of            date NOT NULL,
  amount_base      integer NOT NULL,
  note             text,
  recorded_via     text NOT NULL DEFAULT 'PORTAL',
  recorded_by_name text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_agent_progress_goal_idx ON partner_agent_progress (goal_id, as_of);
