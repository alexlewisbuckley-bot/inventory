-- Corporate partners, and the rate each one buys at.
--
-- Alex: "build a model for real estate companies and corporate businesses
-- that run incentives to have a portal similar to the resellers for
-- purchasing, aquiring and running incentives within their respective
-- businesses ... they have access to preferential rates".
--
-- A new channel beside the trade and the public: a company we set up with an
-- agreed rate, who buys for itself and runs reward campaigns for its staff.
-- This is the entity and the rate, staff-side only. The portal they log into
-- and the campaigns they run are the two steps after it.
--
-- Its own table rather than a flag on resellers. A reseller is a shop selling
-- on our behalf to the public, and carries a shop window, a trade room, a
-- custom domain and a passphrase. A partner is a buyer, and carries a rate,
-- terms and — later — orders and campaigns. The overlap is a name, a logo and
-- somebody to ring; everything that makes either of them what it is belongs
-- to one and not the other.
CREATE TABLE IF NOT EXISTS partners (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL,
  /** What they call themselves, where it differs from our filing name. */
  display_name text,

  contact_name text,
  contact_email text,
  contact_phone text,
  website text,

  /*
   * The rate, in basis points off the asking price. 8% is 800.
   *
   * Hundredths of a percent are finer than anybody negotiates, and integer
   * arithmetic has no rounding of its own — which matters because this
   * multiplies every price the partner is ever quoted. Zero is a real value:
   * a partner set up before terms are agreed buys at retail until they are.
   */
  discount_bps integer NOT NULL DEFAULT 0,

  /* What their people are quoted in. Our books stay in the base. */
  display_currency text NOT NULL DEFAULT 'AED',

  /* Theirs, for when the portal they log into carries their colours. */
  brand_color text NOT NULL DEFAULT '#04173A',
  accent_color text NOT NULL DEFAULT '#0F766E',

  notes text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by_id text REFERENCES users (id) ON DELETE SET NULL
);

-- One live partner per slug. Partial, so deleting a partner frees the name
-- for a company that comes back under new terms — the same rule the rest of
-- this schema uses for soft-deleted rows.
CREATE UNIQUE INDEX IF NOT EXISTS partners_slug_idx
  ON partners (slug) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS partners_active_idx ON partners (is_active, sort_order);
