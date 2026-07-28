-- 0001_initial — Bluecroft Stock baseline schema.
-- Money columns are INTEGER minor units. Timestamps are INTEGER unix-millis.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'STAFF',
  job_title     TEXT,
  phone         TEXT,
  initials      TEXT    NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at INTEGER,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  deleted_at    INTEGER
);
CREATE UNIQUE INDEX users_email_idx  ON users (email);
CREATE INDEX        users_role_idx   ON users (role);
CREATE INDEX        users_active_idx ON users (is_active);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   TEXT    NOT NULL,
  user_agent   TEXT,
  ip_address   TEXT,
  expires_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX sessions_token_idx  ON sessions (token_hash);
CREATE INDEX        sessions_user_idx   ON sessions (user_id);
CREATE INDEX        sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE locations (
  id           TEXT PRIMARY KEY,
  name         TEXT    NOT NULL,
  slug         TEXT    NOT NULL,
  type         TEXT    NOT NULL DEFAULT 'STORE',
  address_line TEXT,
  city         TEXT,
  country      TEXT,
  notes        TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  deleted_at   INTEGER
);
CREATE UNIQUE INDEX locations_slug_idx   ON locations (slug);
CREATE INDEX        locations_active_idx ON locations (is_active);

CREATE TABLE suppliers (
  id           TEXT PRIMARY KEY,
  name         TEXT    NOT NULL,
  contact_name TEXT,
  email        TEXT,
  phone        TEXT,
  country      TEXT,
  notes        TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  deleted_at   INTEGER
);
CREATE UNIQUE INDEX suppliers_name_idx   ON suppliers (name);
CREATE INDEX        suppliers_active_idx ON suppliers (is_active);

CREATE TABLE brands (
  id         TEXT PRIMARY KEY,
  name       TEXT    NOT NULL,
  slug       TEXT    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX brands_slug_idx ON brands (slug);

CREATE TABLE user_preferences (
  user_id             TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  theme               TEXT    NOT NULL DEFAULT 'SYSTEM',
  density             TEXT    NOT NULL DEFAULT 'COMFORTABLE',
  display_currency    TEXT    NOT NULL DEFAULT 'GBP',
  default_location_id TEXT REFERENCES locations (id) ON DELETE SET NULL,
  email_notifications INTEGER NOT NULL DEFAULT 1,
  in_app_notifications INTEGER NOT NULL DEFAULT 1,
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE watches (
  id                 TEXT PRIMARY KEY,
  stock_no           INTEGER NOT NULL,
  brand_id           TEXT    NOT NULL REFERENCES brands (id),
  model              TEXT    NOT NULL,
  nickname           TEXT,
  serial             TEXT,
  condition          TEXT    NOT NULL DEFAULT 'UNKNOWN',
  box_papers         TEXT    NOT NULL DEFAULT 'UNKNOWN',
  year               INTEGER,
  supplier_id        TEXT    NOT NULL REFERENCES suppliers (id),
  purchase_date      INTEGER NOT NULL,
  purchase_price_gbp INTEGER NOT NULL,
  purchase_price_usd INTEGER,
  purchase_fx_rate   INTEGER,
  est_sale_usd       INTEGER,
  location_id        TEXT    NOT NULL REFERENCES locations (id),
  status             TEXT    NOT NULL DEFAULT 'IN_STOCK',
  notes              TEXT,
  created_by_id      TEXT    NOT NULL REFERENCES users (id),
  created_at         INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  deleted_at         INTEGER,
  version            INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX watches_stock_no_idx        ON watches (stock_no);
CREATE INDEX        watches_status_idx          ON watches (status);
CREATE INDEX        watches_location_idx        ON watches (location_id);
CREATE INDEX        watches_supplier_idx        ON watches (supplier_id);
CREATE INDEX        watches_brand_idx           ON watches (brand_id);
CREATE INDEX        watches_purchase_date_idx   ON watches (purchase_date);
CREATE INDEX        watches_serial_idx          ON watches (serial);
CREATE INDEX        watches_status_location_idx ON watches (status, location_id);
CREATE INDEX        watches_deleted_idx         ON watches (deleted_at);

CREATE TABLE watch_photos (
  id         TEXT PRIMARY KEY,
  watch_id   TEXT    NOT NULL REFERENCES watches (id) ON DELETE CASCADE,
  url        TEXT    NOT NULL,
  caption    TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX watch_photos_watch_idx ON watch_photos (watch_id);

CREATE TABLE sales (
  id              TEXT PRIMARY KEY,
  watch_id        TEXT    NOT NULL REFERENCES watches (id) ON DELETE CASCADE,
  invoice_no      TEXT    NOT NULL,
  sale_date       INTEGER NOT NULL,
  sale_amount_usd INTEGER NOT NULL,
  sale_amount_gbp INTEGER NOT NULL,
  sale_fx_rate    INTEGER,
  customer_name   TEXT,
  customer_email  TEXT,
  channel         TEXT    NOT NULL DEFAULT 'RETAIL',
  profit_usd      INTEGER NOT NULL,
  profit_gbp      INTEGER NOT NULL,
  margin_bps      INTEGER NOT NULL,
  notes           TEXT,
  recorded_by_id  TEXT    NOT NULL REFERENCES users (id),
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  deleted_at      INTEGER
);
CREATE UNIQUE INDEX sales_watch_idx   ON sales (watch_id);
CREATE UNIQUE INDEX sales_invoice_idx ON sales (invoice_no);
CREATE INDEX        sales_date_idx    ON sales (sale_date);
CREATE INDEX        sales_channel_idx ON sales (channel);

CREATE TABLE stock_movements (
  id               TEXT PRIMARY KEY,
  watch_id         TEXT    NOT NULL REFERENCES watches (id) ON DELETE CASCADE,
  from_location_id TEXT REFERENCES locations (id),
  to_location_id   TEXT    NOT NULL REFERENCES locations (id),
  reason           TEXT,
  moved_by_id      TEXT    NOT NULL REFERENCES users (id),
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX stock_movements_watch_idx   ON stock_movements (watch_id);
CREATE INDEX stock_movements_created_idx ON stock_movements (created_at);

CREATE TABLE audit_logs (
  id          TEXT PRIMARY KEY,
  entity_type TEXT    NOT NULL,
  entity_id   TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  changes     TEXT,
  summary     TEXT,
  actor_id    TEXT REFERENCES users (id) ON DELETE SET NULL,
  ip_address  TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX audit_entity_idx  ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_actor_idx   ON audit_logs (actor_id);
CREATE INDEX audit_created_idx ON audit_logs (created_at);

CREATE TABLE notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type        TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  body        TEXT,
  entity_type TEXT,
  entity_id   TEXT,
  read_at     INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX notifications_user_read_idx ON notifications (user_id, read_at);
CREATE INDEX notifications_created_idx   ON notifications (created_at);

CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
