-- The customer side of the business becomes first-class.
--
-- Until now a sale carried a buyer's name as free text, which meant the system
-- could tell you a watch had gone but not who to ring when the next one like it
-- arrived. Everything here exists to answer questions that span the two halves
-- of the business: which of my customers wants this watch, what did I last say
-- to them, and what is that conversation worth.
--
-- Design notes that apply throughout:
--   * Money is INTEGER minor units, GBP, matching every existing table.
--   * Enum-like columns are TEXT, declared once in src/lib/enums.ts.
--   * Timeline rows (activities, tasks) carry a nullable foreign key per entity
--     rather than a polymorphic (type, id) pair, so the database can still
--     enforce that the thing being referenced exists.

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customers (
  id                  TEXT PRIMARY KEY,
  reference           TEXT NOT NULL,
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  company             TEXT,
  email               TEXT,
  phone               TEXT,
  alt_phone           TEXT,
  country             TEXT,
  city                TEXT,
  address_line1       TEXT,
  address_line2       TEXT,
  postcode            TEXT,

  -- How they like to be reached, so nobody emails a person who only answers
  -- WhatsApp and then records them as unresponsive.
  preferred_channel   TEXT NOT NULL DEFAULT 'EMAIL',
  language            TEXT,

  tier                TEXT NOT NULL DEFAULT 'STANDARD',
  lead_source         TEXT NOT NULL DEFAULT 'UNKNOWN',
  status              TEXT NOT NULL DEFAULT 'ACTIVE',

  -- Budget as a range in GBP minor units: a ceiling alone reads as a promise.
  budget_min_gbp      INTEGER,
  budget_max_gbp      INTEGER,

  birthday            DATE,
  notes               TEXT,
  risk_notes          TEXT,

  marketing_consent   BOOLEAN NOT NULL DEFAULT FALSE,
  consent_recorded_at TIMESTAMPTZ,

  owner_id            TEXT REFERENCES users (id),
  last_contacted_at   TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_reference_idx ON customers (reference) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS customers_name_idx  ON customers (last_name, first_name);
CREATE INDEX IF NOT EXISTS customers_email_idx ON customers (email);
CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers (phone);
CREATE INDEX IF NOT EXISTS customers_owner_idx ON customers (owner_id);

-- Which brands a customer actually buys. Kept relational rather than as a text
-- field so "who wants a Patek?" is a query rather than a search.
CREATE TABLE IF NOT EXISTS customer_brands (
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  brand_id    TEXT NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  PRIMARY KEY (customer_id, brand_id)
);

-- ---------------------------------------------------------------------------
-- Tags — one vocabulary, shared by customers and suppliers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tags (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  tone       TEXT NOT NULL DEFAULT 'neutral',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tags_label_idx ON tags (lower(label));

CREATE TABLE IF NOT EXISTS entity_tags (
  tag_id      TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tag_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS entity_tags_entity_idx ON entity_tags (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Supplier contacts — the people, not just the company
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS supplier_contacts (
  id          TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        TEXT,
  email       TEXT,
  phone       TEXT,
  is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS supplier_contacts_supplier_idx ON supplier_contacts (supplier_id);

-- ---------------------------------------------------------------------------
-- Deals — the sale before it is a sale
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS deals (
  id                 TEXT PRIMARY KEY,
  reference          TEXT NOT NULL,
  title              TEXT NOT NULL,
  customer_id        TEXT REFERENCES customers (id),
  watch_id           TEXT REFERENCES watches (id),
  stage              TEXT NOT NULL DEFAULT 'ENQUIRY',
  value_gbp          INTEGER,
  probability        INTEGER NOT NULL DEFAULT 20,
  expected_close     DATE,
  owner_id           TEXT REFERENCES users (id),
  source             TEXT NOT NULL DEFAULT 'UNKNOWN',
  notes              TEXT,
  lost_reason        TEXT,
  -- Set when the deal leaves the board, so cycle time is a subtraction rather
  -- than a scan of the event table.
  closed_at          TIMESTAMPTZ,
  stage_changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Position within its column, so a hand-ordered board survives a refresh.
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS deals_reference_idx ON deals (reference) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS deals_stage_idx    ON deals (stage) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS deals_customer_idx ON deals (customer_id);
CREATE INDEX IF NOT EXISTS deals_watch_idx    ON deals (watch_id);
CREATE INDEX IF NOT EXISTS deals_owner_idx    ON deals (owner_id);

CREATE TABLE IF NOT EXISTS deal_stage_events (
  id         TEXT PRIMARY KEY,
  deal_id    TEXT NOT NULL REFERENCES deals (id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage   TEXT NOT NULL,
  actor_id   TEXT REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_stage_events_deal_idx ON deal_stage_events (deal_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Offers — what was actually put to the customer
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS offers (
  id           TEXT PRIMARY KEY,
  deal_id      TEXT REFERENCES deals (id) ON DELETE CASCADE,
  customer_id  TEXT REFERENCES customers (id),
  watch_id     TEXT REFERENCES watches (id),
  amount       INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'GBP',
  amount_gbp   INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'SENT',
  valid_until  DATE,
  notes        TEXT,
  responded_at TIMESTAMPTZ,
  created_by   TEXT REFERENCES users (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offers_deal_idx     ON offers (deal_id);
CREATE INDEX IF NOT EXISTS offers_customer_idx ON offers (customer_id);
CREATE INDEX IF NOT EXISTS offers_watch_idx    ON offers (watch_id);

-- ---------------------------------------------------------------------------
-- Watch requests — demand you do not yet hold
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS watch_requests (
  id             TEXT PRIMARY KEY,
  customer_id    TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  brand_id       TEXT REFERENCES brands (id),
  model          TEXT,
  reference_no   TEXT,
  dial           TEXT,
  bracelet       TEXT,
  condition      TEXT NOT NULL DEFAULT 'UNKNOWN',
  box_papers     TEXT NOT NULL DEFAULT 'UNKNOWN',
  budget_gbp     INTEGER,
  target_date    DATE,
  priority       TEXT NOT NULL DEFAULT 'NORMAL',
  status         TEXT NOT NULL DEFAULT 'OPEN',
  notes          TEXT,
  owner_id       TEXT REFERENCES users (id),
  fulfilled_by   TEXT REFERENCES watches (id),
  fulfilled_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS watch_requests_customer_idx ON watch_requests (customer_id);
CREATE INDEX IF NOT EXISTS watch_requests_status_idx   ON watch_requests (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS watch_requests_brand_idx    ON watch_requests (brand_id);

-- Sourcing attempts against a request: who was asked, and what came back.
CREATE TABLE IF NOT EXISTS request_enquiries (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES watch_requests (id) ON DELETE CASCADE,
  supplier_id TEXT REFERENCES suppliers (id),
  status      TEXT NOT NULL DEFAULT 'SENT',
  quoted_gbp  INTEGER,
  notes       TEXT,
  actor_id    TEXT REFERENCES users (id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS request_enquiries_request_idx ON request_enquiries (request_id);

-- ---------------------------------------------------------------------------
-- Activities — one timeline primitive for every kind of contact
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS activities (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  direction   TEXT NOT NULL DEFAULT 'OUTBOUND',
  subject     TEXT,
  body        TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_min INTEGER,

  customer_id TEXT REFERENCES customers (id) ON DELETE CASCADE,
  supplier_id TEXT REFERENCES suppliers (id) ON DELETE CASCADE,
  watch_id    TEXT REFERENCES watches (id) ON DELETE CASCADE,
  deal_id     TEXT REFERENCES deals (id) ON DELETE CASCADE,
  request_id  TEXT REFERENCES watch_requests (id) ON DELETE CASCADE,

  actor_id    TEXT REFERENCES users (id),
  -- Written by the application rather than a person: a stage change, a matched
  -- request. Rendered differently so a real conversation stands out.
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS activities_customer_idx ON activities (customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS activities_supplier_idx ON activities (supplier_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS activities_watch_idx    ON activities (watch_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS activities_deal_idx     ON activities (deal_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS activities_recent_idx   ON activities (occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Tasks — the follow-up that otherwise lives in someone's head
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  notes        TEXT,
  kind         TEXT NOT NULL DEFAULT 'FOLLOW_UP',
  due_at       TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'OPEN',
  priority     TEXT NOT NULL DEFAULT 'NORMAL',

  assignee_id  TEXT REFERENCES users (id),
  customer_id  TEXT REFERENCES customers (id) ON DELETE CASCADE,
  supplier_id  TEXT REFERENCES suppliers (id) ON DELETE CASCADE,
  watch_id     TEXT REFERENCES watches (id) ON DELETE CASCADE,
  deal_id      TEXT REFERENCES deals (id) ON DELETE CASCADE,
  request_id   TEXT REFERENCES watch_requests (id) ON DELETE CASCADE,

  -- Generated tasks carry the rule that made them, so the same rule firing
  -- twice does not produce two identical reminders.
  auto_key     TEXT,
  completed_at TIMESTAMPTZ,
  completed_by TEXT REFERENCES users (id),
  created_by   TEXT REFERENCES users (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS tasks_auto_key_idx ON tasks (auto_key) WHERE auto_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_open_idx     ON tasks (status, due_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks (assignee_id, status);
CREATE INDEX IF NOT EXISTS tasks_customer_idx ON tasks (customer_id);
CREATE INDEX IF NOT EXISTS tasks_deal_idx     ON tasks (deal_id);

-- ---------------------------------------------------------------------------
-- Sales join the same graph
-- ---------------------------------------------------------------------------
--
-- customer_name stays exactly as it is. Rows recorded before customers existed
-- must keep reading correctly, and a nullable link is how you migrate a live
-- ledger without a rewrite.

ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id      TEXT REFERENCES customers (id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS deal_id          TEXT REFERENCES deals (id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS commission_gbp   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS deposit_gbp      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_status   TEXT NOT NULL DEFAULT 'PAID';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivery_status  TEXT NOT NULL DEFAULT 'COLLECTED';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivered_at     TIMESTAMPTZ;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS warranty_months  INTEGER;

CREATE INDEX IF NOT EXISTS sales_customer_idx ON sales (customer_id);
CREATE INDEX IF NOT EXISTS sales_deal_idx     ON sales (deal_id);
