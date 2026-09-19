-- Counting the stock you are supposed to have.
--
-- Everything in this system says what should be in the safe. Nothing until now
-- said whether it is. For a business holding several hundred thousand pounds
-- of small, portable, individually identifiable objects, that gap is the whole
-- reason stock records exist — an inventory nobody has ever counted is a
-- spreadsheet, not an inventory.
--
-- A check is a session rather than a running tally. The lines are a snapshot
-- of what was expected at the moment it opened, which is the part that makes
-- the arithmetic work: if the list moved underneath the count, a watch sold
-- halfway through the afternoon would silently leave it and the totals would
-- never reconcile. Frozen, "412 expected, 409 found, 3 missing" is a sentence
-- somebody can act on.

CREATE TABLE IF NOT EXISTS stock_checks (
  id              TEXT PRIMARY KEY,
  -- Human-facing name, e.g. "Vault — 19 September". Generated, not typed.
  reference       TEXT NOT NULL,
  -- Null means the whole business. Usually one safe or one shop at a time,
  -- because that is how the counting is actually done.
  location_id     TEXT REFERENCES locations (id),
  status          TEXT NOT NULL DEFAULT 'OPEN',

  -- Frozen at the moment the check opened, so progress can be reported
  -- without recounting the lines on every page load.
  expected_count  INTEGER NOT NULL DEFAULT 0,
  -- Written when the check is completed, not maintained live: a tally that
  -- updates on every scan is a second source of truth for the same fact.
  found_count     INTEGER,
  missing_count   INTEGER,
  elsewhere_count INTEGER,

  notes           TEXT,
  started_by_id   TEXT NOT NULL REFERENCES users (id),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_by_id TEXT REFERENCES users (id),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS stock_checks_status_idx ON stock_checks (status);
CREATE INDEX IF NOT EXISTS stock_checks_started_idx ON stock_checks (started_at);

-- One row per watch that was expected, created when the check opens.
CREATE TABLE IF NOT EXISTS stock_check_lines (
  id                   TEXT PRIMARY KEY,
  check_id             TEXT NOT NULL REFERENCES stock_checks (id) ON DELETE CASCADE,
  watch_id             TEXT NOT NULL REFERENCES watches (id),
  -- Where the record said it would be, copied at snapshot time. Keeping it
  -- here rather than reading the watch means a later move cannot rewrite what
  -- the count was actually looking for.
  expected_location_id TEXT REFERENCES locations (id),
  status               TEXT NOT NULL DEFAULT 'PENDING',
  -- Where it turned out to be, when that is not where it was expected.
  found_location_id    TEXT REFERENCES locations (id),
  notes                TEXT,
  checked_by_id        TEXT REFERENCES users (id),
  checked_at           TIMESTAMPTZ
);

-- One line per watch per check: counting the same watch twice in one session
-- is a mistake, not a second data point.
CREATE UNIQUE INDEX IF NOT EXISTS stock_check_lines_unique_idx
  ON stock_check_lines (check_id, watch_id);
-- The counting screen's own query: everything still outstanding on this check.
CREATE INDEX IF NOT EXISTS stock_check_lines_status_idx ON stock_check_lines (check_id, status);
