/*
# Fix payment_mode CHECK constraints to allow UPI and Cheque

## Problem
The `invoice_payments` table and `invoices` table had CHECK constraints
on `payment_mode` that only allowed 'Cash', 'Online', 'Bank Transfer', 'Other'.
The application UI offers 'UPI' and 'Cheque' as payment modes, but inserting
these values caused a constraint violation, resulting in "Unable to save" errors.

## Changes
1. Drop the existing `invoice_payments_payment_mode_check` constraint.
2. Recreate it with the expanded set: Cash, UPI, Online, Bank Transfer, Cheque, Other.
3. Drop the existing `invoices_payment_mode_check` constraint.
4. Recreate it with the same expanded set.

## Safety
- No data is lost — only CHECK constraints are replaced.
- Existing rows with valid payment_mode values remain valid under the new constraint.
*/

ALTER TABLE invoice_payments DROP CONSTRAINT IF EXISTS invoice_payments_payment_mode_check;
ALTER TABLE invoice_payments ADD CONSTRAINT invoice_payments_payment_mode_check
  CHECK (payment_mode = ANY (ARRAY['Cash'::text, 'UPI'::text, 'Online'::text, 'Bank Transfer'::text, 'Cheque'::text, 'Other'::text]));

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_payment_mode_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_payment_mode_check
  CHECK (payment_mode = ANY (ARRAY['Cash'::text, 'UPI'::text, 'Online'::text, 'Bank Transfer'::text, 'Cheque'::text, 'Other'::text]));
