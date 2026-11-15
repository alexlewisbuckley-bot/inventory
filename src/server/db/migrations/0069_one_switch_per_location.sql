-- One switch per location, and the columns brought into line behind it.
--
-- Alex: "can we make it simple and just have an active - inactive toggle if
-- inactive not to be shown anywhere except on our internal platform and only
-- visable thorugh the location tabs - there is so many ticks for no reason
-- what so ever. Either they are in Dubai and on our website, trade portals,
-- inventory main view or they aren't."
--
-- Four tick boxes asked what is really one question, and one of the four was
-- read nowhere in the application at all. The form now asks once and writes
-- all of them together. This brings the rows that already exist into the same
-- shape, so the first save of a location is not also a silent correction of
-- three columns somebody never saw.
--
-- is_on_hand is the authority: it is the one the stock list, the portal and
-- the campaigns already read, and the one Alex has been setting. Where a
-- location is held away, everything else follows it down.
UPDATE locations
SET publish_to_storefront = false,
    show_in_trade_catalogue = false,
    is_active = false
WHERE is_on_hand = false;

-- And the other way: a location that is on the books is on all of it. This
-- is the half that changes Hong Kong's note from a contradiction into a
-- record of what it used to be — "sells on the site, not offered to the
-- trade" was a distinction this business has now said it does not want.
UPDATE locations
SET is_active = true
WHERE is_on_hand = true AND is_active = false;
