-- Give the model name its own word back, and make room for two more.
--
-- `watches.nickname` has never held a nickname. It holds the model name —
-- "Datejust 41", "Sky-Dweller" — which is why the content grid could only
-- ever label it "Title", and why somebody looking for the column to type
-- "Hulk" into could not find one. The names were effectively swapped:
-- `model` carries the reference number a dealer files by, and `nickname`
-- carried the name a shop window is browsed by.
--
-- Renaming it to `model_name` says what it is and frees the word for what a
-- dealer actually means by it. `model` keeps its wrong name for now: it is
-- referenced far more widely, and one rename at a time is how this stays
-- reviewable.
--
-- Two new columns follow.
--
--   nickname    "Hulk", "Pepsi", "Root Beer", "Batman". The name the piece is
--               asked for by, which is not the model and not a dial colour.
--               It already exists in the business, smuggled into titles
--               ("Submariner Date Green Hulk 40") and into the shop's own
--               model list, which holds three entries that are one family
--               and a nickname wearing quotation marks. A field of its own
--               is what lets a title be composed rather than typed.
--
--   dial_style  "Baton", "Diamond", "Roman", "Arabic". The dial colour
--               answers what shade it is; this answers what is on it, and
--               the two together are how a buyer actually describes a dial.
--               Blue is a filter worth having; blue baton and blue diamond
--               are two different watches at two different prices.
--
-- Both nullable, both free text, like every other field on the content grid.
-- Nothing is backfilled: a nickname cannot be derived from a title without
-- guessing which words in it were the nickname, and this system does not
-- guess at content.

-- Conditional because the two statements that follow are not: a rename that
-- has already happened must not stop the new columns being added, and the
-- order matters — the old column has to stop being called `nickname` before
-- the new one can take the name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'watches' AND column_name = 'nickname'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'watches' AND column_name = 'model_name'
  ) THEN
    ALTER TABLE watches RENAME COLUMN nickname TO model_name;
  END IF;
END $$;

ALTER TABLE watches ADD COLUMN IF NOT EXISTS nickname text;
ALTER TABLE watches ADD COLUMN IF NOT EXISTS dial_style text;
