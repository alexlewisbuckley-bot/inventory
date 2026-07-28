-- 0003_images — photographs of the watch and its warranty card.
--
-- Image bytes are stored in Postgres rather than object storage. At this
-- scale — a few images per watch, a few hundred watches — that avoids adding
-- a second service, a second set of credentials and a second failure mode,
-- and it means a database backup is a complete backup. Uploads are downscaled
-- in the browser before they are sent, so rows stay small.

CREATE TABLE watch_images (
  id            TEXT PRIMARY KEY,
  watch_id      TEXT        NOT NULL REFERENCES watches (id) ON DELETE CASCADE,
  -- ImageKind: WATCH | CARD | DOCUMENT
  kind          TEXT        NOT NULL DEFAULT 'WATCH',
  mime_type     TEXT        NOT NULL,
  byte_size     INTEGER     NOT NULL,
  width         INTEGER,
  height        INTEGER,
  data          BYTEA       NOT NULL,
  caption       TEXT,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_id TEXT REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX watch_images_watch_idx ON watch_images (watch_id, kind, sort_order);

-- The old placeholder table was never written to.
DROP TABLE IF EXISTS watch_photos;
