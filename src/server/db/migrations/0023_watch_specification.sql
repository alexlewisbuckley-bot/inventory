-- What a watch actually is, for the people being sold it.
--
-- The record held everything needed to trade a watch — what it cost, who it
-- came from, where it sits, whether the register has been checked — and almost
-- nothing about the watch itself. A reseller's customer looking at a listing
-- wants the case size, the metal, the dial, the movement: the things that
-- decide whether it is the piece they want. There was nowhere to put any of
-- it, so a shop window could only ever say brand, reference and price.
--
-- All nullable. Stock is booked in at speed from an invoice and the detail
-- arrives later; a required field here would be answered with a guess, and a
-- guessed case size on a public page is worse than a blank one.
--
-- `description` is deliberately separate from `notes`. Notes are internal and
-- say things like "chase the papers"; this is the paragraph a customer reads.

ALTER TABLE watches ADD COLUMN case_size_mm      INTEGER;
ALTER TABLE watches ADD COLUMN case_material     TEXT;
ALTER TABLE watches ADD COLUMN dial              TEXT;
ALTER TABLE watches ADD COLUMN bracelet          TEXT;
ALTER TABLE watches ADD COLUMN movement          TEXT;
ALTER TABLE watches ADD COLUMN water_resistance_m INTEGER;
ALTER TABLE watches ADD COLUMN description       TEXT;
