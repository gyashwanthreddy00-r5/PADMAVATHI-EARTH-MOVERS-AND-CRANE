/*
# Add payment_reference column to invoices

Used by Cash/UPI bills to store the UPI transaction reference directly on the invoice record.
Nullable so existing records are unaffected.
*/
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS payment_reference text;
