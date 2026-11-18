-- A wanted list that both sides can write to.
--
-- Alex: "We also need to add a sourcing request CTA that is easily visable for
-- agents and procurers in case we don't have the exact watch or item they are
-- looking for."
--
-- There is already a queue for this — `watch_requests`, the Wanted board the
-- procurers work from — and the right answer is for an agent's ask to land in
-- it rather than in an inbox of its own. Two lists of "what are we looking
-- for" is one list that is wrong.
--
-- What has to give is the assumption baked into the column: that whoever
-- wants a watch is a customer of ours. A partner's agent is not. So a request
-- now belongs to a customer OR to a partner, and the check keeps it from
-- belonging to nobody.

ALTER TABLE watch_requests ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE watch_requests
  ADD COLUMN IF NOT EXISTS partner_id text REFERENCES partners (id) ON DELETE SET NULL;
ALTER TABLE watch_requests
  ADD COLUMN IF NOT EXISTS partner_agent_id text REFERENCES partner_agents (id) ON DELETE SET NULL;

-- Who typed it. The portal has one passphrase for a whole company, so the
-- door says which company and nothing about which person — and "Mo asked for
-- this" is the difference between a queue somebody can work and a list of
-- anonymous wants.
ALTER TABLE watch_requests ADD COLUMN IF NOT EXISTS asked_by_name text;

CREATE INDEX IF NOT EXISTS watch_requests_partner_idx
  ON watch_requests (partner_id) WHERE deleted_at IS NULL;

-- Somebody wants it, or it should not be on the board.
ALTER TABLE watch_requests DROP CONSTRAINT IF EXISTS watch_requests_asker_chk;
ALTER TABLE watch_requests ADD CONSTRAINT watch_requests_asker_chk
  CHECK (customer_id IS NOT NULL OR partner_id IS NOT NULL);
