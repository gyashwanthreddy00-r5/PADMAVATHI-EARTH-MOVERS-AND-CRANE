/*
# Fix diesel_entries payment_status CHECK constraint

## Problem
The `diesel_entries.payment_status` column had a CHECK constraint
allowing only `'Paid'` and `'Pending'`, but the application sends
`'Partially Paid'` when the user pays a partial amount. This caused
every insert/update with a partial payment to fail with a constraint
violation, which surfaced as a generic "Unable to save" error.

## Changes
- Drop the old CHECK constraint on `diesel_entries.payment_status`.
- Add a new CHECK constraint that also allows `'Partially Paid'`.

## Security
- No RLS or policy changes.
*/

ALTER TABLE public.diesel_entries
  DROP CONSTRAINT IF EXISTS diesel_entries_payment_status_check;

ALTER TABLE public.diesel_entries
  ADD CONSTRAINT diesel_entries_payment_status_check
  CHECK (payment_status IN ('Paid','Pending','Partially Paid'));
