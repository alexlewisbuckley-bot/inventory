-- A reseller's shop, at the reseller's own address.
--
-- The shop window has always been reachable only through a long random token
-- in the path, because that token is the whole of the access control. It works,
-- and it is unusable as a thing to put in front of a customer: nobody sends a
-- buyer a link with thirty-two characters of base64 in it and expects to be
-- taken seriously.
--
-- So a reseller may point a hostname of their own at this deployment, and the
-- host becomes the identifier the shop is found by. Nothing else about the page
-- changes — the same branding, the same live stock, the same prices.
--
-- Note what that costs. The token hid the page from everybody who had not been
-- handed it; a hostname does not hide anything, because a hostname is public by
-- construction. A shop on a custom domain is a public shop. That is the trade
-- being made deliberately here rather than discovered later, and it is why the
-- token route keeps working unchanged for anybody who would rather stay behind
-- an unguessable URL.
ALTER TABLE resellers ADD COLUMN IF NOT EXISTS custom_domain TEXT;

-- When a request for that hostname first reached us.
--
-- The honest verification. We cannot usefully check from here that somebody's
-- DNS is correct — but a request arriving on their hostname is proof that it
-- is, because nothing else could have delivered it. So the first such request
-- stamps this column and the management page stops saying "waiting".
ALTER TABLE resellers ADD COLUMN IF NOT EXISTS custom_domain_seen_at TIMESTAMPTZ;

-- One hostname, one shop. A second reseller claiming a hostname that is
-- already serving somebody else's stock is a mistake worth refusing at the
-- point of typing, not a race to be resolved by whichever request lands first.
--
-- Partial, so a removed reseller does not hold a hostname hostage, and over
-- `lower()` because a hostname is case-insensitive and two rows differing only
-- in case are the same claim.
CREATE UNIQUE INDEX IF NOT EXISTS resellers_custom_domain_idx
  ON resellers (lower(custom_domain))
  WHERE custom_domain IS NOT NULL AND deleted_at IS NULL;
