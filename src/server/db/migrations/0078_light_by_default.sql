-- Light unless somebody asks for dark.
--
-- Alex, on a phone whose operating system is in dark mode: "Please update
-- to light mode only mine is showing black I don't like it being black or
-- at least have light as default and dark mode as a selection."
--
-- The default was SYSTEM, which follows the phone. That is a reasonable
-- default for a personal app and the wrong one for this: the brand is ivory
-- and sage, the screenshots and the printed paperwork are light, and a
-- dealer showing a customer a watch on their phone was getting a black
-- screen nobody chose.
--
-- Both halves of the change. The default is for rows written from now on;
-- the update is for the rows that already exist, because everyone on SYSTEM
-- today is on it by not having picked, and leaving them there would mean
-- the change reached nobody. Dark is still one tap away in Settings, and a
-- person who picks it keeps it.
ALTER TABLE user_preferences ALTER COLUMN theme SET DEFAULT 'LIGHT';

UPDATE user_preferences SET theme = 'LIGHT' WHERE theme = 'SYSTEM';
