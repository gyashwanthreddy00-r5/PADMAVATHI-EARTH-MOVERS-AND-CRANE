/*
# GST Billing lines — add VL No, remove Batta

GST Billing (invoice_billing_lines) needs a manual VL No field per working-day
line (Working Date -> Vehicle -> Ton auto -> VL No manual -> Rate Type), and
must not include Batta anywhere in its calculation, table, or summary.

Only `invoice_billing_lines` is touched. `invoices`, `invoice_vehicles`,
`invoice_vehicle_sessions`, `invoice_items`, and every PO Orders table are
untouched.
*/

ALTER TABLE public.invoice_billing_lines
  ADD COLUMN IF NOT EXISTS vl_no text NOT NULL DEFAULT '';

ALTER TABLE public.invoice_billing_lines
  DROP COLUMN IF EXISTS batha;
