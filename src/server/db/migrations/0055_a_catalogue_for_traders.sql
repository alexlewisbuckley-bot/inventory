-- A list we can hand a dealer, without handing them the business.
--
-- Alex: "Create a catalogue link that shows all the watches except in
-- transit & hong kong to show traders what we have with filtering and no
-- pricing."
--
-- Two things, and they are separate on purpose: which of our places a
-- trader may be shown, and the links themselves.

-- ---------------------------------------------------------------------------
-- Which places a trader may be shown stock from.
-- ---------------------------------------------------------------------------
--
-- A second switch rather than a reuse of publish_to_storefront, because they
-- are two different questions and Hong Kong is the proof. Hong Kong stock is
-- real stock that the website may well sell; what it is not is stock we want
-- on a list handed round the trade. Folding that into the storefront switch
-- would have taken it off onestreetwatches.com as the price of taking it off
-- the dealer list, and nobody asked for that.
--
-- Transit is the case where the two agree, and it agrees for the same reason
-- it does on the storefront: a watch in a courier's bag is not a watch
-- anybody can be offered today.
--
-- True by default, so a place nobody has an opinion about is on the list --
-- the same default publish_to_storefront took, and for the same reason: a
-- column arriving should not quietly empty a list.
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS show_in_trade_catalogue BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE locations SET show_in_trade_catalogue = FALSE WHERE type = 'TRANSIT';

-- Hong Kong, by whatever field it is recorded in. Matched on text rather
-- than on an id because the id is different in every environment, and left
-- as data rather than a rule so that somebody can disagree with it from the
-- locations screen without asking an engineer -- which is the whole lesson
-- of migration 0036.
UPDATE locations SET show_in_trade_catalogue = FALSE
WHERE name ILIKE '%hong kong%'
   OR city ILIKE '%hong kong%'
   OR country ILIKE '%hong kong%'
   OR slug LIKE '%hong-kong%';

-- ---------------------------------------------------------------------------
-- The links.
-- ---------------------------------------------------------------------------
--
-- Several, not one. A single standing URL cannot be withdrawn from one dealer
-- without being withdrawn from all of them, and the first thing anybody wants
-- after handing a link to a WhatsApp group is a different link for the next
-- group. So each one is labelled, and revoking is per link.
--
-- The token is the credential, held apart from the id exactly as a
-- reseller's is, and 24 random bytes for the same reason.
--
-- No passphrase. The reseller trade room insists on one because its token is
-- minted as one half of a door and the gap between the two halves would be a
-- public page; here the token IS the whole secret and is never issued
-- half-made. Worth knowing when deciding who to send one to.
CREATE TABLE IF NOT EXISTS catalogue_links (
  id              text PRIMARY KEY,
  -- Who it was made for, in our own words: "Dubai dealers", "Hassan's
  -- group". Without it a list of revoked tokens says nothing about which
  -- link was withdrawn from whom.
  label           text NOT NULL,
  token           text NOT NULL,
  is_active       boolean NOT NULL DEFAULT TRUE,
  -- Whether this link offers the trade shots behind the tap. Off by default:
  -- a trade shot is a record picture, often with the papers in frame, and a
  -- link that may be forwarded is the wrong place for it until somebody says
  -- otherwise.
  show_trade_photos boolean NOT NULL DEFAULT FALSE,
  -- Proof of life, so a link nobody has opened in three months can be
  -- recognised as one worth withdrawing.
  last_viewed_at  timestamptz,
  view_count      integer NOT NULL DEFAULT 0,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by_id   text REFERENCES users (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS catalogue_links_token_idx ON catalogue_links (token);
CREATE INDEX IF NOT EXISTS catalogue_links_active_idx ON catalogue_links (is_active);
