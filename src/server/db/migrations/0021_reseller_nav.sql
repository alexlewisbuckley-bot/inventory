-- Navigation back to the reseller's own website.
--
-- The shop window is a page on somebody else's site as far as their customer
-- is concerned, so it needs the way back: the same top-level links their own
-- site has. Without them the page is a dead end that happens to have a logo on
-- it, which is what it felt like.
--
-- Stored as a small JSON array rather than a table of its own. It is an
-- ordered list of at most a handful of pairs, edited as one block on one form,
-- and never queried across resellers — a table would buy ordering and CRUD
-- nobody needs and cost a join on every page load.
--
-- The hrefs are validated as http(s) before they are written. They become
-- anchors on a public page, and "javascript:" in a link somebody pasted from a
-- brand guide is the sort of thing that has to be refused at the edge rather
-- than escaped later.

ALTER TABLE resellers ADD COLUMN nav_links TEXT;
