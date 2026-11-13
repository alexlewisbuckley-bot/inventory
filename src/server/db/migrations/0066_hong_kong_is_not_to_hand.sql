-- Hong Kong is not stock within reach.
--
-- 0065 gave every location a switch and turned it off for transit, and left
-- the overseas one to be ticked by hand on the grounds that it is a judgement
-- rather than a fact. That was right about the judgement and wrong about who
-- should have to make it: Alex had already made it, in the sentence that
-- started the whole change — "ALL EXCEPT IN TRANSIT AND OVERSEAS FOR EXAMPLE
-- HONG KONG" — and then had to find a checkbox to say it again. He didn't,
-- and the stock list spent a day offering him watches in another country.
--
-- So it is set here, once, from what he already said. The switch stays: a
-- location that starts being somewhere people fly to and back from in a day
-- is a tick away from counting as to hand again.
UPDATE locations
SET is_on_hand = false
WHERE lower(name) LIKE '%hong kong%'
   OR lower(coalesce(country, '')) IN ('hong kong', 'hk');
