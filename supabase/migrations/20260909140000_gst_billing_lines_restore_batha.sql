/*
# GST Billing lines — restore per-line Batha

An earlier migration (20260908180000_gst_billing_lines_vl_no_no_batha.sql)
dropped `batha` from `invoice_billing_lines`. GST/Company Billing now needs
a per-line Batha again: auto-filled from Rate Master when a vehicle is
selected, but editable per billing entry, and included in that line's
total_amount (and therefore in taxable_amount/GST via the existing
rentalSubtotal sum in the app).

Only `invoice_billing_lines` is touched. `invoices`, `invoice_vehicles`,
`invoice_vehicle_sessions`, `invoice_items`, and every PO Orders table are
untouched. Existing rows get batha = 0 via the column default, so
historical billing lines are unaffected.
*/

ALTER TABLE public.invoice_billing_lines
  ADD COLUMN IF NOT EXISTS batha numeric NOT NULL DEFAULT 0;
