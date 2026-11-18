-- What the agent says they are going to do about it.
--
-- Alex: "it should also have a survey feature for agents to set their targets
-- at the start of the year and have a plan against obtaining it."
--
-- One row per goal, because a plan is a thing somebody writes once in January
-- and amends, not a log. The figure here is the agent's own — the company's
-- target stays on partner_agent_goals and is only replaced by this one if
-- somebody at the company says so. A scheme where the person being measured
-- sets the measure, silently, is not a scheme.
CREATE TABLE IF NOT EXISTS partner_agent_plans (
  id                   text PRIMARY KEY,
  goal_id              text NOT NULL REFERENCES partner_agent_goals(id) ON DELETE CASCADE,
  -- What they are aiming at.
  proposed_target_base integer,
  -- And how: deals, in their own words, and what they need from the company.
  deals_target         integer,
  approach             text,
  support              text,
  submitted_at         timestamptz,
  accepted_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- One per goal: the second row would be a second plan nobody chose between.
CREATE UNIQUE INDEX IF NOT EXISTS partner_agent_plans_goal_idx ON partner_agent_plans (goal_id);
