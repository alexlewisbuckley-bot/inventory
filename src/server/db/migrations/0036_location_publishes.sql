-- Which of our places the website is allowed to sell from.
--
-- A watch in a courier's bag between Dubai and London is not a watch anybody
-- can come and see, and the storefront says "available to view today" on
-- every live plate. The first version of this read the location's TYPE and
-- treated TRANSIT as the rule, which is right about today and wrong as a
-- design: it is the sort of thing that only one person knows, nobody can
-- change without a deploy, and that quietly does the wrong thing the moment
-- there is a place it did not anticipate — a bonded warehouse, a watch away
-- at service, a consignment case in a shop that is not ours to sell from.
--
-- So it becomes a property of the location, set where locations are managed.
-- Everything publishes unless somebody says otherwise, because that is what
-- was true before this column existed and a migration should not quietly
-- take a shop's stock off its website.
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS publish_to_storefront BOOLEAN NOT NULL DEFAULT TRUE;

-- Except transit, which is the case that prompted this and is already the
-- hard-coded behaviour. Carrying it across as data rather than as a rule
-- means the setting now says out loud what the code used to assume, and that
-- somebody can disagree with it without asking an engineer.
UPDATE locations SET publish_to_storefront = FALSE WHERE type = 'TRANSIT';
