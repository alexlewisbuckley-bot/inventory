-- An API key that can be set without a deploy.
--
-- Alex, after the key check reported the key well formed and still refused:
-- "Can we add a setting and intsturctions to connect the API key."
--
-- Until now the key could only come from an environment variable, which on
-- this host is read when the application is built. So changing it did
-- nothing until the next deploy — one of the three reasons the AI features
-- kept stopping, and the one with the least obvious cause, because
-- everything looks correctly configured while the running copy holds the old
-- value.
--
-- Its own table rather than app_settings, for two reasons that are both
-- about not leaking it. updateSettings writes the old and new VALUES of
-- every changed setting into the audit trail, which is a page in this
-- application; and getSettings returns every setting to the page that
-- renders the form. A key routed through either would be on screen.
--
-- The secret is stored sealed: AES-256-GCM under a key derived from
-- AUTH_SECRET. Not a vault — AUTH_SECRET lives on the same machine — but a
-- database is copied, into backups and staging dumps and bug reports, and
-- those copies now carry nothing usable on their own.
CREATE TABLE IF NOT EXISTS stored_secrets (
  -- One row per thing. 'anthropic' is the only one today.
  name text PRIMARY KEY,
  -- The sealed value. Never read by anything that renders.
  secret text NOT NULL,
  -- What may safely be shown: a prefix everybody's key shares and a length.
  -- Enough to tell one key from another at a glance, worth nothing on its own.
  hint text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text REFERENCES users (id) ON DELETE SET NULL
);
