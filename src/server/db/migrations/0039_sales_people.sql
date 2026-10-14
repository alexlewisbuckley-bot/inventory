-- Who sold the watch.
--
-- The ledger already recorded `recorded_by_id` — whoever typed the sale in —
-- and that is a different question. The person at the counter and the person
-- at the keyboard are often not the same, and on a busy day one of them books
-- in the other's sales. Attributing a month's commission to whoever happened
-- to be sitting down is how a sales report stops being read.
--
-- A list of its own rather than the user table. Selling does not require a
-- login: a seat costs money and widens the attack surface, and somebody on
-- the shop floor who never opens the system still closed the deal. The link
-- to a user is kept but optional, so the two can be tied together where both
-- exist without forcing an account on anybody who does not need one.

CREATE TABLE IF NOT EXISTS sales_people (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  -- Where this person also signs in. Nullable, and ON DELETE SET NULL: losing
  -- an account must not take the attribution of every sale they ever made
  -- with it.
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Somebody who has left stops being offered without their past sales
  -- disappearing from a report. Deactivating is the ordinary act here;
  -- deleting is for a name typed wrongly.
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_people_slug_idx   ON sales_people (slug);
CREATE        INDEX IF NOT EXISTS sales_people_active_idx ON sales_people (is_active);

-- Nullable, and it stays nullable. Every sale recorded before today has no
-- answer to this question, and inventing one — defaulting to the person who
-- typed it in, or to whoever is first alphabetically — would put a number
-- against a name that did not earn it. "Not recorded" is the truth for those
-- rows and the reports say so.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS sold_by_id TEXT REFERENCES sales_people(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sales_sold_by_idx ON sales (sold_by_id);

-- The six who sell today. Ordered as given rather than alphabetically, since
-- that is the order they were named in and no other order means anything yet.
-- `ON CONFLICT DO NOTHING` so re-running cannot duplicate a name, and so a
-- name that has since been renamed or deactivated is not resurrected.
INSERT INTO sales_people (id, name, slug, sort_order) VALUES
  ('slp_seed000000francesca', 'Francesca', 'francesca', 10),
  ('slp_seed0000000000zoe', 'Zoe',       'zoe',       20),
  ('slp_seed000000000alex', 'Alex',      'alex',      30),
  ('slp_seed00000000edward', 'Edward',   'edward',    40),
  ('slp_seed0000000grace', 'Grace',      'grace',     50),
  ('slp_seed000000gabriella', 'Gabriella', 'gabriella', 60)
ON CONFLICT (slug) DO NOTHING;
