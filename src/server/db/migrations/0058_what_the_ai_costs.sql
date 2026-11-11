-- What the AI costs, and a ceiling on it.
--
-- Alex: "5 cent per watch is fine but why does the claude API keep going off
-- and how do i retain it in the system to work for AI based work and check
-- and manage the costs."
--
-- Four features call a model and none of them left a trace anybody could
-- add up. The token counts came back on every response and went into the
-- log, where they are visible to whoever has the log open at the time and to
-- nobody afterwards. So "what did this cost us last month" had no answer,
-- and neither did "what is spending it".
--
-- One row per call, including the ones that failed: a refused request still
-- took time and a rejected key is the thing worth seeing a run of. The cost
-- is worked out and frozen at the moment of the call, because published
-- prices change and March's bill should still read as March's in June.
CREATE TABLE IF NOT EXISTS ai_usage (
  id text PRIMARY KEY,
  -- Which feature spent it: the invoice reader, the gap scanner, the
  -- photograph reader, the Xero screenshots. A month's bill that cannot be
  -- attributed cannot be acted on.
  feature text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  -- Millionths of a dollar. Null where the model is not in the price table,
  -- which reads as "unknown" rather than as free.
  cost_micros integer,
  -- Null when the model refused, timed out or was never reached; the error
  -- then says which. Kept because a run of failures is the clearest signal
  -- that a key has lapsed, and it is invisible if only successes are stored.
  ok boolean NOT NULL DEFAULT true,
  error text,
  actor_id text REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The two questions actually asked of this table: what has it cost since a
-- date, and what has each feature cost since a date.
CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage (created_at);
CREATE INDEX IF NOT EXISTS ai_usage_feature_idx ON ai_usage (feature, created_at);
