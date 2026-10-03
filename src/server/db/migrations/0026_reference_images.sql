-- A bank of photographs, kept against the reference rather than the watch.
--
-- A photograph of a 179383 is a photograph of every 179383. Until now one
-- lived only on the watch it was uploaded to, so when that watch sold its
-- picture went with it, and the next 179383 through the door started from
-- nothing — the same photograph taken again, of the same model, for the third
-- time. Over a year that is the whole photography budget spent on work
-- already done.
--
-- So a watch photograph is also banked here, under its brand and reference,
-- and any watch of that reference can take a copy. A copy, deliberately: the
-- watch owns its own row in `watch_images` exactly as before, so one selling
-- and being cleaned up cannot pull a picture out from under another listing.
-- This table is the library; `watch_images` stays the gallery.
--
-- Only photographs of the watch itself are banked. A warranty card carries a
-- serial, a date and a dealer's stamp: it belongs to one watch and copying it
-- onto another would assert a history that watch does not have.
CREATE TABLE reference_images (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,

  -- Upper-cased with every separator removed, so `126711 CHNR`, `126711-chnr`
  -- and `126711CHNR` are one reference and not three shelves.
  reference TEXT NOT NULL,
  -- The reference as somebody wrote it, for showing back to them.
  label TEXT NOT NULL,

  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  data BYTEA NOT NULL,

  -- SHA-256 of the bytes. The same photograph uploaded to three watches of
  -- one reference is one picture, and a library that shows it three times is
  -- a library nobody scrolls to the end of.
  digest TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- What makes banking idempotent: the same bytes under the same reference are
-- inserted once, and every upload after that is a no-op rather than a row.
CREATE UNIQUE INDEX reference_images_unique_idx
  ON reference_images (brand_id, reference, digest);

-- The only read: everything banked for one reference, newest first.
CREATE INDEX reference_images_lookup_idx
  ON reference_images (brand_id, reference, created_at DESC);
