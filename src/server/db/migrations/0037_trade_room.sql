-- A second door into the stock, for the trade.
--
-- The shop window at /s/<token> shows a reseller's customers what we have:
-- the catalogue photograph, the retail price, one watch to a card. It is a
-- shop, and it is built like one.
--
-- What a dealer wants is the opposite of that. They want the actual
-- photograph of the actual watch — the one taken on a desk with the papers
-- beside it — and they do not want our retail price anywhere near the
-- conversation, because the number they will pay is the one we agree on the
-- phone. Showing a retail figure to a dealer prices the negotiation before it
-- starts.
--
-- So it is a separate link rather than a setting on the existing one. The two
-- audiences see different pictures and different facts, and a flag that
-- switched a shop between them would mean one URL whose meaning depends on a
-- checkbox somebody toggled last March.
ALTER TABLE resellers
  ADD COLUMN IF NOT EXISTS trade_token TEXT,
  -- A password, not an account. The people on the other end of this are
  -- dealers we already know by name and phone number, and making each of them
  -- a login is a user to create, a reset to field and a row to forget to
  -- remove. One passphrase per reseller, which we set and can change, is the
  -- access control that matches how the relationship actually works.
  --
  -- Hashed with the same scrypt as a staff password. It is weaker in use —
  -- it gets shared, as a shared secret does — but there is no reason for the
  -- stored form to be the weak part, and a leaked table should not hand
  -- anybody the passphrase they are likely to have reused.
  ADD COLUMN IF NOT EXISTS trade_password_hash TEXT,
  -- When the passphrase last changed, which is what signs the cookie. Change
  -- the passphrase and every browser already holding one is turned out,
  -- without a session table to sweep.
  ADD COLUMN IF NOT EXISTS trade_password_set_at TIMESTAMPTZ;

-- Nobody has one until somebody opens it. The column is nullable rather than
-- defaulted precisely so that a token existing means the door exists: there
-- is no state where every reseller silently has a trade link that nobody
-- decided to give them.
CREATE UNIQUE INDEX IF NOT EXISTS resellers_trade_token_idx
  ON resellers (trade_token) WHERE trade_token IS NOT NULL;
