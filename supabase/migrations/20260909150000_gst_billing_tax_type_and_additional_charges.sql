/*
# GST Billing — Tax Type (incl. No Tax) + Additional Charges

GST / Company Billing's Charges section needs a third Additional Charges line
(alongside the existing Up/Down Transportation columns), and the existing
CGST+SGST / IGST toggle needs an explicit "No Tax" option. Persisting the
selected tax type avoids guessing it back from tax amounts when an invoice
is reloaded (a 0% tax invoice would otherwise be indistinguishable from "No
Tax" selected).

Only `invoices` is touched. Existing rows default to 'cgst_sgst' (today's
implicit behavior) and additional_charges_amount 0, so historical invoices
are unaffected.
*/

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS tax_type text NOT NULL DEFAULT 'cgst_sgst' CHECK (tax_type IN ('cgst_sgst', 'igst', 'no_tax')),
  ADD COLUMN IF NOT EXISTS additional_charges_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS additional_charges_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_charges_description text;
