-- Recording that a buy-back is going round again.
--
-- Alex: "He's agreed to pay the interest again for another month, but there
-- doesn't seem to be a way to really easily record that that's happening
-- again for the month after... it should automatically renew but if we know
-- sooner we should also be able to click a button."
--
-- The billing already rolls on its own: every month a loan stays open earns
-- a charge, raised on read. What had nowhere to live was the *agreement* —
-- the conversation where the customer says they will take another month. So
-- the loan ran past the date it was due to be redeemed with nothing on the
-- screen acknowledging it, and the only ways to say so were to do nothing
-- at all or to write a second loan, which would double its principal.
--
-- A row per renewal rather than a count on the loan, for the same reason
-- the charges are rows: "he has rolled on four times, most recently on the
-- 2nd" is the question this answers, and a single number cannot.
CREATE TABLE IF NOT EXISTS buyback_renewals (
  id              text PRIMARY KEY,
  buyback_id      text NOT NULL REFERENCES buybacks(id) ON DELETE CASCADE,
  -- When the customer agreed, which is not always when it was entered.
  agreed_on       timestamptz NOT NULL DEFAULT now(),
  -- Both ends, so a renewal stays readable after the loan's date moves on.
  previous_due_on timestamptz,
  new_due_on      timestamptz NOT NULL,
  months          integer NOT NULL DEFAULT 1,
  -- The extension fee raised alongside it, where one was charged. Null is
  -- the ordinary case: most renewals are just another month of interest.
  charge_id       text REFERENCES buyback_charges(id) ON DELETE SET NULL,
  note            text,
  recorded_by_id  text NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS buyback_renewals_loan_idx
  ON buyback_renewals (buyback_id, agreed_on DESC);
