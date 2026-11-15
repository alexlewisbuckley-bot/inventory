-- H&M is not stock within reach either.
--
-- Same call as 0066 made for Hong Kong, for the same reason: Alex said so —
-- "Set default to not show H&M as well" — and should not have to go and find
-- the switch to say it a second time. The switch stays, so H&M is one tick
-- away from counting as to hand again.
UPDATE locations
SET is_on_hand = false
WHERE lower(trim(name)) IN ('h&m', 'h & m', 'h and m');
