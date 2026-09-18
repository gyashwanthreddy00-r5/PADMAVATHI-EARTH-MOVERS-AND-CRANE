/*
  # Widen emi_records.payment_mode CHECK constraint

  ## Problem
  `emi_records.payment_mode` only allowed 'Cash','Online','Bank Transfer','Other'
  (from the original base schema), but `src/pages/Emi.tsx`'s "Mark Paid"
  modal already offers UPI and Cheque, matching the app-wide `PaymentMode`
  type in `src/types/index.ts`. Saving an EMI payment as UPI or Cheque would
  fail with a constraint violation — the same class of bug already fixed for
  `invoice_payments`/`invoices` in 20260831114049 and 20260913061500.

  ## Changes
  Drop and recreate the constraint with the full app-wide set. Additive
  only — no existing rows use a value outside the old set.
*/

ALTER TABLE public.emi_records DROP CONSTRAINT IF EXISTS emi_records_payment_mode_check;
ALTER TABLE public.emi_records ADD CONSTRAINT emi_records_payment_mode_check
  CHECK (payment_mode IN ('Cash','UPI','Online','Bank Transfer','Cheque','NEFT','RTGS','Other'));
