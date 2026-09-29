-- Who owns each watch, as distinct from where it is.
--
-- Location already answers "where is this"; nothing answered "whose is this".
-- Stock sitting on one shelf can belong to the trading company, to a sister
-- company, or to a private individual whose piece is held or sold on their
-- behalf — and the answer changes what a stocktake, an insurance schedule and
-- a set of accounts may each say about it.
--
-- Ownership and location move independently: a watch can go to the vault
-- without changing hands, and can change hands without leaving the shelf. So
-- this is its own column rather than a property of the location.

CREATE TABLE owners (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'BUSINESS',
  legal_name      TEXT,
  registration_no TEXT,
  contact_name    TEXT,
  contact_email   TEXT,
  contact_phone   TEXT,
  notes           TEXT,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  sort_order      INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX owners_slug_idx   ON owners (slug);
CREATE INDEX        owners_active_idx ON owners (is_active);

-- Nullable, deliberately. Every watch already in stock has an owner in real
-- life, but nobody has told the system which one, and stamping a guess onto
-- the records the accounts are built from is worse than an honest blank that
-- the list can be filtered by and worked through.
ALTER TABLE watches ADD COLUMN owner_id TEXT REFERENCES owners (id);
CREATE INDEX watches_owner_idx ON watches (owner_id);

-- The three the business actually trades through. Inserted here rather than in
-- the seed so they exist in every environment, including the one already
-- carrying live stock, which the seed never runs against again.
INSERT INTO owners (id, name, slug, type, legal_name, sort_order) VALUES
  ('own_onestreet', 'One Street Watches LLC',     'one-street-watches-llc',     'BUSINESS',   'One Street Watches LLC',     1),
  ('own_bluecroft', 'Bluecroft Traders Limited',  'bluecroft-traders-limited',  'BUSINESS',   'Bluecroft Traders Limited',  2),
  ('own_ejackson',  'Edward Jackson',             'edward-jackson',             'INDIVIDUAL', NULL,                         3)
ON CONFLICT (slug) DO NOTHING;
