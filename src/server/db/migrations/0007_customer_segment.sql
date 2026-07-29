-- The two lines of business, on the customer.
--
-- Sales already carried a channel, but that describes one transaction. The
-- distinction the business actually runs on is what kind of counterparty
-- somebody is: a dealer you trade with, or a person you sell to. It decides
-- the pricing you quote, the paperwork you need and the way you talk to them,
-- and it does not change from one sale to the next.
--
-- Defaults to RETAIL: every customer on the book before this column existed
-- was captured through the consumer side of the business.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_type TEXT NOT NULL DEFAULT 'RETAIL';

CREATE INDEX IF NOT EXISTS customers_type_idx ON customers (customer_type) WHERE deleted_at IS NULL;
