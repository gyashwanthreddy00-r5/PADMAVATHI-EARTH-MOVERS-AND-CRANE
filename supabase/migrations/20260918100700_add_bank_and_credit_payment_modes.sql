/*
  # Add 'Bank' and 'Credit' payment modes

  ## Why
  - "Record Payment" (SettlementReport.tsx) gets a new selectable mode,
    'Bank', alongside the existing Cash/UPI/Bank Transfer/Cheque/Other set.
  - "Record Company Payment" (Invoices.tsx) no longer asks which payment
    mode was used - every company payment is inherently a receipt into the
    business's bank account, so it's now hard-coded to payment_mode =
    'Credit' client-side. 'Credit' still isn't 'Cash', so the existing
    sync_invoice_payment_to_bank trigger's Cash-skip check still correctly
    treats it as bank-eligible and posts it as a Credit bank_transactions
    row exactly as before - no trigger logic changes needed, only the
    CHECK constraints need to accept the new literal values.

  ## Changes
  Widen the payment_mode CHECK constraint (additive only, no data changes)
  on the three tables that constrain it: invoice_payments, invoices,
  bank_transactions. `customer_payments.payment_mode` has no CHECK
  constraint at all, so it already accepts 'Credit' without changes.
*/

ALTER TABLE public.invoice_payments DROP CONSTRAINT IF EXISTS invoice_payments_payment_mode_check;
ALTER TABLE public.invoice_payments ADD CONSTRAINT invoice_payments_payment_mode_check
  CHECK (payment_mode IN ('Cash','UPI','Online','Bank Transfer','Cheque','NEFT','RTGS','Bank','Credit','Other'));

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_payment_mode_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_payment_mode_check
  CHECK (payment_mode IN ('Cash','UPI','Online','Bank Transfer','Cheque','NEFT','RTGS','Bank','Credit','Other'));

ALTER TABLE public.bank_transactions DROP CONSTRAINT IF EXISTS bank_transactions_payment_mode_check;
ALTER TABLE public.bank_transactions ADD CONSTRAINT bank_transactions_payment_mode_check
  CHECK (payment_mode IN ('Bank Transfer','UPI','Cheque','NEFT','RTGS','Online','Bank','Credit','Other'));
