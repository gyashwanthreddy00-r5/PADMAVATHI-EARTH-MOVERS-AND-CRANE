/*
# Add recorded_by column to invoice_payments

1. Changes
- `invoice_payments`: add `recorded_by` text column (nullable) to track which user recorded the payment.
  This is used by the Cash & Payment Report to show "User who recorded the payment".
- No existing data is modified — the new column is nullable and defaults to NULL for historical rows.
2. Security
- No RLS policy changes needed — existing policies already cover the new column.
3. Notes
- The column is plain text (not a FK to user_profiles) because the user's display name is
  captured at payment time for audit purposes, similar to `created_by_name` on invoices.
- Historical payments will have NULL in this column, which the UI will display as '-'.
*/

ALTER TABLE invoice_payments
  ADD COLUMN IF NOT EXISTS recorded_by text;
