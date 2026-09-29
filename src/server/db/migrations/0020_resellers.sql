-- Resellers, and the shop window each one gets.
--
-- A reseller sells our stock to their own customers. They need to see what is
-- actually available and what it is priced at, without seeing anything else
-- about the business: not what it cost us, not who we bought it from, not where
-- it is sitting. So this is a record of who they are and how their shop window
-- is branded, plus the one secret that opens it.
--
-- The token is the credential. It is long and random rather than derived from
-- the name, because a guessable URL is not access control, and it is stored
-- separately from the id so it can be rotated without breaking anything that
-- refers to the reseller. Rotating it revokes every link already handed out.

CREATE TABLE resellers (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL,
  -- What their customers see at the top of the page, where it differs from the
  -- name we file them under.
  display_name   TEXT,
  headline       TEXT,
  intro          TEXT,

  contact_name   TEXT,
  contact_email  TEXT,
  contact_phone  TEXT,
  website        TEXT,

  -- Branding. Colours are stored as written so they can be pasted straight from
  -- a brand guide; the form validates them as hex.
  brand_color    TEXT NOT NULL DEFAULT '#04173A',
  accent_color   TEXT NOT NULL DEFAULT '#0F766E',
  logo_mime      TEXT,
  logo_data      BYTEA,
  logo_byte_size INTEGER,

  -- The shop window.
  public_token   TEXT NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  -- What their customers are quoted in. Our retail price, converted for them.
  display_currency TEXT NOT NULL DEFAULT 'USD',

  notes          TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ,
  created_by_id  TEXT REFERENCES users (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX resellers_slug_idx  ON resellers (slug);
CREATE UNIQUE INDEX resellers_token_idx ON resellers (public_token);
CREATE INDEX        resellers_active_idx ON resellers (is_active);
