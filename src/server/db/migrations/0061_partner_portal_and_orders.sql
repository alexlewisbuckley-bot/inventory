-- The door a partner comes through, and what they reserve once inside.
--
-- Step two of the partner portal. Step one gave a company a rate; this gives
-- it a way in and a way to say "we want that one", which is the whole of what
-- a portal is before campaigns sit on top of it.
--
-- The door is modelled on the reseller trade room, because it is the same
-- problem and that one has already been through contact with reality: a long
-- unguessable token in the link, a shared passphrase over it, and no user
-- account anywhere. A partner's buyer is not a member of staff and should not
-- hold a login to this system; what they hold is a link and a word.

-- A token with no passphrase opens nothing, so these three move together and
-- a partner has no door at all until somebody opens one. Issuing a token is
-- then itself the record that this company was given portal access, rather
-- than every partner quietly having a door nobody decided to give them.
ALTER TABLE partners ADD COLUMN IF NOT EXISTS portal_token text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS portal_password_hash text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS portal_password_set_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS partners_portal_token_idx
  ON partners (portal_token) WHERE portal_token IS NOT NULL;

-- What a partner asked to buy.
--
-- An order holds a watch and records what was agreed for it. Not a sale: no
-- money moves in the portal, and the piece is still ours until somebody here
-- raises an invoice the ordinary way.
CREATE TABLE IF NOT EXISTS partner_orders (
  id text PRIMARY KEY,
  partner_id text NOT NULL REFERENCES partners (id) ON DELETE CASCADE,
  watch_id text NOT NULL REFERENCES watches (id) ON DELETE CASCADE,

  /*
   * The three numbers as they stood when the order was placed, in base minor
   * units and basis points.
   *
   * This is not the stored partner price that step one went out of its way to
   * avoid. That was a price kept ALONGSIDE a live one, which goes stale and
   * then quotes somebody a figure we no longer offer. This is history: what
   * the asking price was, what the rate was, and therefore what was agreed,
   * at one moment that has already happened. Repricing the watch afterwards
   * must not move it — an order reads back as what was actually promised, and
   * the conversation when a partner queries their invoice is about this row.
   */
  asking_at_order integer NOT NULL,
  discount_bps_at_order integer NOT NULL,
  price_at_order integer NOT NULL,

  /*
   * Who placed it, as free text they typed.
   *
   * There is no user account behind a portal order, so this is a name and an
   * email somebody wrote into a form on the other side of a shared passphrase.
   * It is a note to help our team ring the right person back, and is treated
   * as exactly that: never matched against a customer, never trusted as an
   * identity.
   */
  placed_by_name text,
  placed_by_email text,
  note text,

  /*
   * PLACED while the watch is held, RELEASED when somebody here lets it go,
   * COMPLETED when it has been invoiced and sold through the ordinary flow.
   *
   * No EXPIRED. Alex: "If they reserve the watches they should go on hold and
   * we have a way to retract them if payment isn't made manually." A hold that
   * ages out on its own would put a watch back on offer in the middle of a
   * conversation nobody here knew was still running.
   */
  status text NOT NULL DEFAULT 'PLACED',

  placed_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  released_by_id text REFERENCES users (id) ON DELETE SET NULL,
  release_reason text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One live hold per watch. Two partners reserving the same piece within a
-- minute of each other is the failure this exists for, and it is a race no
-- amount of checking-then-writing in the application wins on its own.
CREATE UNIQUE INDEX IF NOT EXISTS partner_orders_live_watch_idx
  ON partner_orders (watch_id) WHERE status = 'PLACED';

CREATE INDEX IF NOT EXISTS partner_orders_partner_idx
  ON partner_orders (partner_id, placed_at DESC);
