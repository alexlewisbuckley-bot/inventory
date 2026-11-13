-- Whether stock standing here is stock you can put your hands on.
--
-- Alex: "DEFAULT IS ONE STREET WATCHES BUT DEFAULT SHOULD BE ALL EXCEPT IN
-- TRANSIT AND OVERSEAS FOR EXAMPLE HONG KONG".
--
-- The stock list opened on the first store, which answered "what is on the
-- shelf in front of me" — a fair question, and the wrong one by default for
-- somebody running the business across a vault, a workshop and a shop. What
-- they want is everything within reach, which is everything except the two
-- kinds of stock that is not: in a courier's bag, or in another country.
--
-- A switch rather than a guess. Transit can be read off the location's type,
-- but overseas cannot: Hong Kong is a store like any other, and whether its
-- stock counts as to hand is a decision about how this business works, not a
-- fact to infer from a country column that is blank on most rows. The other
-- two switches on this table are explicit for the same reason.
ALTER TABLE locations ADD COLUMN IF NOT EXISTS is_on_hand boolean NOT NULL DEFAULT true;

-- Transit is never to hand, and nobody should have to say so. Set once here
-- rather than read from the type at query time, so there is one answer to the
-- question and not two that can disagree.
UPDATE locations SET is_on_hand = false WHERE type = 'TRANSIT';
