-- Reward campaigns a partner runs for its own people.
--
-- Step three, and the reason the other two exist. Alex: "real estate companies
-- and corporate businesses that run incentives to have a portal similar to the
-- resellers for purchasing, aquiring and running incentives within their
-- respective businesses".
--
-- The shape of the thing: a company decides to reward some of its staff with a
-- watch, sets up a campaign in its portal, and sends each person a link. The
-- person picks one. We get a hold on the piece and a phone call to make — the
-- same machinery step two already built, now with a name attached to who chose
-- it and why.
CREATE TABLE IF NOT EXISTS partner_campaigns (
  id text PRIMARY KEY,
  partner_id text NOT NULL REFERENCES partners (id) ON DELETE CASCADE,

  /** What the company calls it: "Q4 top performers", "Ten years' service". */
  name text NOT NULL,
  /** What each recipient reads at the top of their page, in the company's words. */
  intro text,

  /*
   * Two kinds, chosen per campaign.
   *
   * BUDGET: each person is given an amount and picks anything at or under it.
   * SHORTLIST: the company picks the watches and each person chooses one.
   *
   * Not points. A points scheme is a currency we would have to issue, price,
   * expire and account for, and none of that is a thing a watch dealer should
   * be in the middle of. Both kinds here resolve to the same act — one person,
   * one watch, one hold — which is why they can share everything below.
   */
  kind text NOT NULL DEFAULT 'SHORTLIST',

  /*
   * For a BUDGET campaign: what each recipient may spend, in base minor units,
   * measured against the partner's own price rather than the asking price.
   *
   * Their rate is the arrangement, so a 20,000 budget at 8% off buys a watch
   * we ask 21,700 for. Measuring against the asking price instead would quietly
   * hand back the discount the company negotiated.
   */
  budget_base integer,

  /*
   * DRAFT while it is being built, OPEN while recipients may choose, CLOSED
   * once it is done. A link into a draft or a closed campaign opens nothing:
   * half-built campaigns get sent out by accident, and a campaign that ended
   * should not still be giving away stock.
   */
  status text NOT NULL DEFAULT 'DRAFT',

  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS partner_campaigns_partner_idx
  ON partner_campaigns (partner_id, created_at DESC);

-- The watches a SHORTLIST campaign offers.
--
-- A row here is a nomination, not a reservation: the piece stays on sale to
-- everybody until somebody actually claims it. A campaign that held its whole
-- shortlist would take twenty watches off the market for a month to give away
-- three.
CREATE TABLE IF NOT EXISTS partner_campaign_items (
  id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES partner_campaigns (id) ON DELETE CASCADE,
  watch_id text NOT NULL REFERENCES watches (id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_campaign_items_unique_idx
  ON partner_campaign_items (campaign_id, watch_id);

-- The people being rewarded, and the link each one is sent.
CREATE TABLE IF NOT EXISTS partner_campaign_recipients (
  id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES partner_campaigns (id) ON DELETE CASCADE,

  name text NOT NULL,
  email text,

  /*
   * One long random token per person, and no passphrase over it.
   *
   * Deliberate, and the one place in this system where a door has a single
   * lock. The alternative is asking somebody's warehouse manager to remember a
   * phrase to collect a gift they did not ask for, which is how a reward
   * scheme ends with half its recipients ringing HR. The token is per person,
   * so a forwarded link is traceable to whoever forwarded it, and what it
   * opens is one campaign's watches and nothing else.
   */
  token text NOT NULL,

  /** Set when they choose. One watch each, and the order carries the hold. */
  claimed_order_id text REFERENCES partner_orders (id) ON DELETE SET NULL,
  claimed_at timestamptz,
  /** Their own words at the moment of choosing, for whoever rings them. */
  claim_note text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_campaign_recipients_token_idx
  ON partner_campaign_recipients (token);

CREATE INDEX IF NOT EXISTS partner_campaign_recipients_campaign_idx
  ON partner_campaign_recipients (campaign_id, created_at);

-- Which campaign an order came from, where it came from one at all.
--
-- Nullable, because a partner buying for itself through the portal is still
-- the ordinary case and has no campaign behind it. On the held-stock list this
-- is the difference between "somebody at the company wants this" and "this is
-- Priya's ten-year award", which is not a difference to make our side guess at
-- on the phone.
ALTER TABLE partner_orders ADD COLUMN IF NOT EXISTS campaign_id text
  REFERENCES partner_campaigns (id) ON DELETE SET NULL;
ALTER TABLE partner_orders ADD COLUMN IF NOT EXISTS recipient_id text
  REFERENCES partner_campaign_recipients (id) ON DELETE SET NULL;
