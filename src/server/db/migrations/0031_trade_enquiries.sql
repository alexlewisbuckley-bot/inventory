-- A dealer saying "I want that", and the conversation that follows.
--
-- Deliberately not a deal. A deal is something we have decided to pursue, and
-- anybody with a login being able to put one on the board makes the board
-- worthless — so an enquiry sits here until somebody approves it, and only
-- then does a deal exist. The link back is kept so the board row and the
-- conversation that produced it stay joined.
CREATE TABLE trade_enquiries (
  id TEXT PRIMARY KEY,
  watch_id TEXT REFERENCES watches(id) ON DELETE SET NULL,
  -- What the piece was called at the time, so this still reads if it goes.
  subject TEXT NOT NULL,

  trader_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'INTEREST',
  -- What they offered, when they named a figure. Nullable: most enquiries are
  -- a question, and a zero would read as an offer of nothing.
  offer_gbp INTEGER,

  status TEXT NOT NULL DEFAULT 'OPEN',
  deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decided_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,

  -- One timestamp per side rather than a flag per message: "has the dealer
  -- seen my reply" is the only question anybody asks of it.
  trader_read_at TIMESTAMPTZ,
  staff_read_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX trade_enquiries_status_idx ON trade_enquiries (status, created_at DESC);
CREATE INDEX trade_enquiries_trader_idx ON trade_enquiries (trader_id, created_at DESC);
CREATE INDEX trade_enquiries_watch_idx ON trade_enquiries (watch_id);

-- The thread. Both sides write here; who wrote it is the only distinction,
-- because a conversation split into "their messages" and "our messages" is
-- two tables that have to be read back in order anyway.
CREATE TABLE trade_messages (
  id TEXT PRIMARY KEY,
  enquiry_id TEXT NOT NULL REFERENCES trade_enquiries(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX trade_messages_enquiry_idx ON trade_messages (enquiry_id, created_at);
