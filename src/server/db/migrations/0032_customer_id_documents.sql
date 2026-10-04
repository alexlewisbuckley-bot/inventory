-- Identity documents, for either side of the counter.
--
-- `supplier_documents` already held a director's passport with everything
-- such a thing needs: the bytes, whose it is, when it expires, who uploaded
-- it, a soft delete, and one audited route that serves it. A customer's
-- passport needs exactly that and nothing else, and the one thing that must
-- not happen to sensitive bytes is two code paths handling them — one of
-- which gets the security fix.
--
-- So the table takes a customer as well as a supplier, exactly one of them.
-- The name is now narrower than the contents; renaming it is a cosmetic
-- change to thirty-odd references and is left for a quieter day.
ALTER TABLE supplier_documents ALTER COLUMN supplier_id DROP NOT NULL;
ALTER TABLE supplier_documents ADD COLUMN customer_id TEXT REFERENCES customers(id) ON DELETE CASCADE;

-- Exactly one subject. A document belonging to both, or to neither, is a row
-- nobody can answer a question about.
ALTER TABLE supplier_documents
  ADD CONSTRAINT supplier_documents_one_subject
  CHECK (num_nonnulls(supplier_id, customer_id) = 1);

CREATE INDEX supplier_documents_customer_idx ON supplier_documents (customer_id);
