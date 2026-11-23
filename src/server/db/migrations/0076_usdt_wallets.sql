-- The money, as the chain recorded it.
--
-- Alex: "we need an inovative way to utilise AI and our USDT wallet addresses
-- the record all transactions, there should be a feature to scan the USDT
-- wallet address and link them to transactions accordingly and flag any other
-- amounts missing or things we should be aware of."
--
-- Four tables, the same shape the Xero reconcile already uses: a run, the
-- rows it found, and the links somebody approved. The difference is where the
-- rows come from — a public blockchain rather than an export — which makes
-- them better evidence than an invoice: the chain cannot be edited after the
-- fact and every payment is on it whether or not anybody wrote it down.
--
-- Nothing here ever holds a private key, and nothing here can move money. An
-- address is public information; reading it is all this does.

CREATE TABLE IF NOT EXISTS wallets (
  id              text PRIMARY KEY,
  label           text NOT NULL,
  chain           text NOT NULL,
  -- As the chain writes it. TRON is case-sensitive base58; Ethereum is
  -- stored lower-cased, because the same address arrives in four different
  -- capitalisations and they are one wallet.
  address         text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  -- How far back the first scan should look. Without it the first scan of a
  -- three-year-old wallet pulls every transfer it ever had.
  watch_from      timestamptz,
  created_by_id   text REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

-- One wallet per address per chain: the same address on TRON and Ethereum is
-- two different wallets, and the same address twice on one chain is a mistake.
CREATE UNIQUE INDEX IF NOT EXISTS wallets_address_idx
  ON wallets (chain, address) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS wallet_scans (
  id           text PRIMARY KEY,
  -- Null means every active wallet, which is the ordinary case.
  wallet_id    text REFERENCES wallets(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'RUNNING',
  found        integer NOT NULL DEFAULT 0,
  added        integer NOT NULL DEFAULT 0,
  error        text,
  actor_id     text REFERENCES users(id) ON DELETE SET NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX IF NOT EXISTS wallet_scans_recent_idx ON wallet_scans (started_at DESC);

-- One transfer of one token, as the chain has it.
CREATE TABLE IF NOT EXISTS wallet_transfers (
  id            text PRIMARY KEY,
  wallet_id     text NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  chain         text NOT NULL,
  tx_hash       text NOT NULL,
  -- Where an explorer gives one. Neither of the two we read does, which is
  -- why it does not appear in the identity below.
  log_index     integer NOT NULL DEFAULT 0,
  direction     text NOT NULL,
  counterparty  text NOT NULL,
  -- The integer the chain stores, kept as text because it is up to 256 bits
  -- and because rounding somebody's payment is not a thing to do casually.
  amount_raw    text NOT NULL,
  -- The same figure in cents. USDT is six decimals on both chains and is
  -- treated as a dollar, which is what the desk means when it quotes one.
  amount_usd    integer NOT NULL,
  token_symbol  text NOT NULL DEFAULT 'USDT',
  contract      text NOT NULL,
  block_time    timestamptz NOT NULL,
  -- The scan that first saw it, so a run can be reviewed as a batch.
  scan_id       text REFERENCES wallet_scans(id) ON DELETE SET NULL,
  -- Everything the explorer said, kept whole. A field we do not read today
  -- is a field somebody will need when a payment is disputed.
  raw           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Set when somebody says this one is not ours to reconcile: a transfer
  -- between our own wallets, a gas top-up, a test of a new address.
  ignored_at    timestamptz,
  ignored_by_id text REFERENCES users(id) ON DELETE SET NULL,
  ignore_reason text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- What makes two rows the same transfer.
--
-- Re-scanning a window is the normal case — it is how a scan catches what
-- arrived since — and it must not produce a second copy of a payment. The
-- obvious key is the hash and the log index, and neither explorer returns a
-- log index: TronGrid and Etherscan both give one row per transfer with the
-- transaction's hash on it and nothing to tell two transfers in the same
-- transaction apart. So the identity is what the row says: who paid whom,
-- how much, in which transaction.
--
-- The cost is a real one, stated rather than hidden: a single transaction
-- that moved the identical amount from the same address to the same address
-- twice is stored once. That is a contract doing something unusual, not a
-- customer paying an invoice, and the alternative — a position in a page of
-- API results — silently duplicates a payment every time a page boundary
-- moves, which is the failure that actually happens.
CREATE UNIQUE INDEX IF NOT EXISTS wallet_transfers_identity_idx
  ON wallet_transfers (chain, tx_hash, direction, counterparty, amount_raw);
CREATE INDEX IF NOT EXISTS wallet_transfers_time_idx ON wallet_transfers (block_time DESC);
CREATE INDEX IF NOT EXISTS wallet_transfers_wallet_idx ON wallet_transfers (wallet_id, block_time DESC);

-- What a transfer paid for.
--
-- A row per pairing rather than a column on either side, because neither
-- direction is one-to-one: one payment can settle two invoices, and one
-- invoice is routinely paid in three transfers over a week.
CREATE TABLE IF NOT EXISTS wallet_links (
  id            text PRIMARY KEY,
  transfer_id   text NOT NULL REFERENCES wallet_transfers(id) ON DELETE CASCADE,
  -- Exactly one of these, by the check below. Typed columns rather than one
  -- untyped id, so the database still knows the link points at something
  -- real and still cleans up after a deleted row.
  sale_id       text REFERENCES sales(id) ON DELETE CASCADE,
  brokerage_id  text REFERENCES brokerages(id) ON DELETE CASCADE,
  -- This record's share of the transfer, in cents.
  amount_usd    integer NOT NULL,
  -- RULE, AI or HUMAN: who thought of it. Kept after approval, because "the
  -- model suggested this and somebody agreed" is a different fact from
  -- "somebody typed it in".
  basis         text NOT NULL DEFAULT 'RULE',
  confidence    integer NOT NULL DEFAULT 0,
  reason        text,
  approved_at   timestamptz,
  approved_by_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wallet_links DROP CONSTRAINT IF EXISTS wallet_links_target_chk;
ALTER TABLE wallet_links ADD CONSTRAINT wallet_links_target_chk CHECK (
  (sale_id IS NOT NULL)::int + (brokerage_id IS NOT NULL)::int = 1
);

CREATE INDEX IF NOT EXISTS wallet_links_transfer_idx ON wallet_links (transfer_id);
CREATE INDEX IF NOT EXISTS wallet_links_sale_idx ON wallet_links (sale_id);
CREATE INDEX IF NOT EXISTS wallet_links_brokerage_idx ON wallet_links (brokerage_id);

-- A counterparty we have seen before.
--
-- The second payment from the same address is the easiest match in the
-- system and the chain gives it away for free: an address that paid invoice
-- 1727 in March is almost certainly the same customer in June. Learned on
-- approval rather than typed in.
CREATE TABLE IF NOT EXISTS wallet_counterparties (
  id           text PRIMARY KEY,
  chain        text NOT NULL,
  address      text NOT NULL,
  customer_id  text REFERENCES customers(id) ON DELETE SET NULL,
  partner_id   text REFERENCES partners(id) ON DELETE SET NULL,
  label        text,
  note         text,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_counterparties_address_idx
  ON wallet_counterparties (chain, address);
