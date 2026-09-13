/*
  # Allow NEFT / RTGS payment modes

  The new "Record Company Payment" flow (customer-wise payments) offers
  NEFT and RTGS alongside the existing Cash/UPI/Bank Transfer/Cheque/Other
  modes. Extends the same CHECK constraints the 2026-08-31 UPI/Cheque fix
  already updated, the same way (additive only - no existing values change).
*/

ALTER TABLE invoice_payments DROP CONSTRAINT IF EXISTS invoice_payments_payment_mode_check;
ALTER TABLE invoice_payments ADD CONSTRAINT invoice_payments_payment_mode_check
  CHECK (payment_mode = ANY (ARRAY['Cash'::text, 'UPI'::text, 'Online'::text, 'Bank Transfer'::text, 'Cheque'::text, 'NEFT'::text, 'RTGS'::text, 'Other'::text]));

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_payment_mode_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_payment_mode_check
  CHECK (payment_mode = ANY (ARRAY['Cash'::text, 'UPI'::text, 'Online'::text, 'Bank Transfer'::text, 'Cheque'::text, 'NEFT'::text, 'RTGS'::text, 'Other'::text]));
