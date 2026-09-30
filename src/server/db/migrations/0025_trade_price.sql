-- A third price: what the trade pays.
--
-- Cost is what we paid, retail is what a customer pays, and between them sits
-- the figure another dealer is quoted. It was being kept in spreadsheets and
-- read off them into emails, which is how the same watch goes out at two
-- different numbers on the same day.
--
-- Nullable, because not every watch is offered to the trade and a zero would
-- read as "free" rather than "not quoted".
ALTER TABLE watches ADD COLUMN trade_price_gbp INTEGER;

-- The figure as agreed, in the currency it was agreed in, exactly as the
-- purchase and retail prices already keep theirs. Converting on the way in and
-- storing only the result means the number the dealer was quoted is gone.
ALTER TABLE watches ADD COLUMN trade_amount INTEGER;
ALTER TABLE watches ADD COLUMN trade_currency TEXT NOT NULL DEFAULT 'USD';

-- Priced stock is the common read for a trade catalogue, and it is the only
-- query that scans on this column.
CREATE INDEX watches_trade_price_idx ON watches (trade_price_gbp) WHERE trade_price_gbp IS NOT NULL;
