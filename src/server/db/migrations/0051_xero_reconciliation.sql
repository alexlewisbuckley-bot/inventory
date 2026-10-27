-- Reconciling the sales ledger against Xero.
--
-- Alex: "We reconciled 14 sales against 12 Xero invoices by hand today and
-- 11 of them had at least one error. That needs to stop."
--
-- The rule the whole feature turns on: Xero is the source of truth for the
-- invoice number, the invoice date, the customer name, the amount, the
-- currency and the payment status. This system owns everything else — stock
-- number, reference, brand, cost, sold-by, channel, notes — and nothing
-- here is allowed to write any of those.
--
-- Four tables and one column.
--
--   xero_imports     one dropped file, and whether it has been applied
--   xero_invoices    the invoices that file contained, as read
--   xero_links       which invoice answers for which sale, and for how much
--   customer_aliases what this system calls somebody against what Xero does
--
-- The staged invoices are kept rather than parsed and thrown away. An
-- import that has been applied is the only record of what Xero said at the
-- time, and "the sales table disagrees with Xero" is a question that gets
-- asked weeks later, when the export has long since been deleted from
-- somebody's downloads folder.

CREATE TABLE IF NOT EXISTS xero_imports (
  id              text PRIMARY KEY,
  file_name       text NOT NULL,
  -- The organisation's base currency at the time, so a historic import is
  -- still readable after the base changes.
  base_currency   text NOT NULL DEFAULT 'AED',
  invoice_count   integer NOT NULL DEFAULT 0,
  -- Rows in the file that carried no invoice number: totals, separators,
  -- notes. Counted rather than dropped silently, so the import can say how
  -- much of the file it did not understand.
  skipped_rows    integer NOT NULL DEFAULT 0,
  imported_by_id  text NOT NULL REFERENCES users (id),
  -- Null until somebody approves it. Alex: "Nothing writes until approved."
  applied_at      timestamptz,
  applied_by_id   text REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS xero_imports_recent_idx ON xero_imports (created_at DESC);

CREATE TABLE IF NOT EXISTS xero_invoices (
  id              text PRIMARY KEY,
  import_id       text NOT NULL REFERENCES xero_imports (id) ON DELETE CASCADE,
  invoice_no      text NOT NULL,
  contact_name    text NOT NULL DEFAULT '',
  invoice_date    timestamptz,
  due_date        timestamptz,
  currency        text NOT NULL DEFAULT 'AED',
  -- The invoice total in its own currency, in minor units. Converted only
  -- where something has to be compared, never stored pre-converted: the
  -- rate is editable per invoice and a stored conversion would go stale.
  total           integer NOT NULL DEFAULT 0,
  -- The rate used to read this invoice in base, scaled as everywhere else.
  -- Editable per invoice, which is why it lives on the row.
  fx_rate         integer,
  -- Xero's own word: PAID, AWAITING_PAYMENT, OVERDUE, VOIDED, DRAFT.
  status          text NOT NULL DEFAULT 'DRAFT',
  reference       text NOT NULL DEFAULT '',
  -- The line descriptions, as read. Searched for a stock number, and shown
  -- on the review screen so somebody can see what the invoice was for.
  lines           jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Where it sat in the file, for the exceptions report to point at.
  source_rows     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Set when the user says this invoice is not a sale at all.
  -- Alex: "go into a Buy Back pending bucket".
  bucket          text NOT NULL DEFAULT 'SALE',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS xero_invoices_import_idx ON xero_invoices (import_id);
CREATE INDEX IF NOT EXISTS xero_invoices_number_idx ON xero_invoices (invoice_no);

CREATE TABLE IF NOT EXISTS xero_links (
  id              text PRIMARY KEY,
  import_id       text NOT NULL REFERENCES xero_imports (id) ON DELETE CASCADE,
  xero_invoice_id text NOT NULL REFERENCES xero_invoices (id) ON DELETE CASCADE,
  sale_id         text NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
  -- How it was found: invoice, stock, fuzzy, manual. Kept because the tier
  -- is how much the match is worth trusting, and a fuzzy one that turns out
  -- wrong should be findable afterwards.
  tier            text NOT NULL,
  -- This sale's share of the invoice total, in the invoice's currency and
  -- minor units. The shares across one invoice sum to its total exactly.
  allocated       integer NOT NULL DEFAULT 0,
  -- Null until the user decides. True applies, false rejects.
  approved        boolean,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- A sale belongs to one invoice within one import. Linking it twice is a
-- mistake rather than a thing to merge.
CREATE UNIQUE INDEX IF NOT EXISTS xero_links_sale_idx ON xero_links (import_id, sale_id);
CREATE INDEX IF NOT EXISTS xero_links_invoice_idx ON xero_links (xero_invoice_id);

-- What this system calls somebody, against what Xero calls them.
--
-- Alex: "Henry Fisher" → "Sweepings Hands", "Trend Sourcing" →
-- "Trendsourcing Dubai". The first pair shares no letters at all, which is
-- why no amount of fuzzy matching replaces this table.
CREATE TABLE IF NOT EXISTS customer_aliases (
  id              text PRIMARY KEY,
  system_name     text NOT NULL,
  xero_name       text NOT NULL,
  -- Normalised on write so a lookup does not have to lower-case the table.
  xero_key        text NOT NULL,
  customer_id     text REFERENCES customers (id) ON DELETE SET NULL,
  approved_by_id  text REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_aliases_key_idx ON customer_aliases (xero_key);

-- When Xero says the money arrived.
--
-- Alex: "Record paid date from Xero." The payment status already exists and
-- says whether it was paid; this says when, which is what an aged debtors
-- question actually needs.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS paid_on timestamptz;

-- Which import last accounted for this sale.
--
-- Alex's last data-quality flag is "Sale with no matching Xero invoice on
-- last import", and that cannot be answered without remembering which
-- import each sale was seen in.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS xero_seen_import_id text
  REFERENCES xero_imports (id) ON DELETE SET NULL;
