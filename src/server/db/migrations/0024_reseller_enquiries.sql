-- Enquiries from a reseller's customers.
--
-- The shop window could only offer a mailto link, which needs a mail client
-- configured on the customer's machine and leaves no trace here when it is
-- not. Worse, it only appeared at all when the reseller had filled in a
-- contact address — so the one reseller who had not simply had no way for
-- anybody to enquire.
--
-- So an enquiry is recorded first and sent second. Storing it is the part that
-- must not fail: email needs a provider, a key and a network, and any of those
-- being absent is not a reason to lose somebody asking to buy a watch. The
-- send is attempted afterwards and its outcome kept against the row, so an
-- unsent enquiry is visible rather than silent.

CREATE TABLE reseller_enquiries (
  id            TEXT PRIMARY KEY,
  reseller_id   TEXT NOT NULL REFERENCES resellers (id) ON DELETE CASCADE,
  -- Nullable: the piece may be sold or withdrawn later, and the enquiry is
  -- still a person who asked about something.
  watch_id      TEXT REFERENCES watches (id) ON DELETE SET NULL,
  -- What the piece was at the time, so the enquiry still reads correctly when
  -- the watch is gone.
  subject       TEXT NOT NULL,

  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  message       TEXT,

  -- 'PENDING' until a send is attempted, then 'SENT' or 'FAILED'.
  delivery      TEXT NOT NULL DEFAULT 'PENDING',
  delivery_note TEXT,
  handled_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reseller_enquiries_reseller_idx ON reseller_enquiries (reseller_id, created_at DESC);
CREATE INDEX reseller_enquiries_delivery_idx ON reseller_enquiries (delivery);
