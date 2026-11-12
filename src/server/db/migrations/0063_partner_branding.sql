-- A partner's own mark, on the pages their people see.
--
-- Alex: "add a way to brand the sites with logo colours etc from partner
-- companies, posting their URL and having claude skin it would be ideal."
--
-- The colours already existed and were never editable — the form carried them
-- as hidden fields at our own navy and teal, so every partner portal looked
-- like our software rather than like theirs. The logo is new, stored as bytes
-- beside the reseller's for the same reason that one is: a partner's mark is
-- small, changes rarely, and belongs with the record rather than in a bucket
-- somebody has to keep in step with the database.
ALTER TABLE partners ADD COLUMN IF NOT EXISTS logo_mime text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS logo_data bytea;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS logo_byte_size integer;

/*
 * Where the branding was taken from, and when.
 *
 * Kept so the screen can say "taken from theircompany.com in March" rather
 * than presenting colours as if somebody here chose them. A partner who
 * redesigns their site is then a thing somebody can notice and redo, instead
 * of a portal that quietly looks a year out of date.
 */
ALTER TABLE partners ADD COLUMN IF NOT EXISTS brand_source_url text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS brand_taken_at timestamptz;
