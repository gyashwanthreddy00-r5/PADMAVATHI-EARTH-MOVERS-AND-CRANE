/*
# Fix invoices.payment_status CHECK constraint

## Problem
The `invoices.payment_status` column had a CHECK constraint allowing only
`'Paid'` and `'Pending'` (from the original base schema), but the app's own
`BillStatus` type (src/types/index.ts) and every Cash/UPI Bill and GST
invoice payment-recording screen already send `'Partially Paid'` for
partially-paid invoices - the same value already accepted by the sibling
`invoices.invoice_status` column. This caused every Cash/UPI Bill saved with
"Partially Paid" to fail with:
  new row for relation "invoices" violates check constraint "invoices_payment_status_check"
and forced a workaround elsewhere (GST invoice payment recording) that
silently stored 'Pending' instead of 'Partially Paid', hiding the true
status from anything filtering on payment_status.

## Changes
- Drop the old CHECK constraint on `invoices.payment_status`.
- Add a new CHECK constraint that also allows `'Partially Paid'`, matching
  `invoices.invoice_status` and `diesel_entries.payment_status` (see
  20260904113418_fix_diesel_payment_status_constraint.sql).
- No existing rows use a value outside ('Paid','Pending'), so this is a
  pure widening of the constraint - no data is changed, normalized, or lost.

## Security
- No RLS or policy changes.
*/

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_payment_status_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_payment_status_check
  CHECK (payment_status IN ('Paid','Pending','Partially Paid'));
