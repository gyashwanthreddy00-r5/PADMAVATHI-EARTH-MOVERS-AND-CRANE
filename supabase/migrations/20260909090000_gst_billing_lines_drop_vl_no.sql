/*
# GST Billing lines — remove VL No

The New GST Invoice flow (`GstBillingEntry.tsx`, `invoice_billing_lines`)
no longer collects a VL No per working-day line.

Only `invoice_billing_lines` is touched. PO Orders (`po_working_records`,
which has its own independent `vl_no` column) and every other table
(`invoices`, `invoice_vehicles`, `invoice_vehicle_sessions`, `invoice_items`)
are untouched.
*/

ALTER TABLE public.invoice_billing_lines
  DROP COLUMN IF EXISTS vl_no;
