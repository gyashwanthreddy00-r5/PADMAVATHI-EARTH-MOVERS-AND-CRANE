/*
# Add invoice-level Operator Batha charge

1. Purpose
   - GST Billing Entry previously collected Operator Batha per billing entry (per
     working-day line), generating one "OPERATOR BATHA" invoice line per entry.
   - It is now a single invoice-level charge instead, entered as a Rate and a
     Quantity (Amount = Rate x Quantity), positioned after Down Transportation -
     the same pattern Up/Down Transportation already use, but with two inputs
     instead of one since the amount is a product, not a flat figure.

2. New Columns on `invoices`
   - `operator_batha_enabled` (boolean, default false) - whether the charge applies
   - `operator_batha_rate` (numeric, default 0) - rate per unit
   - `operator_batha_quantity` (numeric, default 0) - quantity
   - The computed amount (rate x quantity) reuses the existing `batha` column,
     which already exists on `invoices` but was unused by GST Billing Entry.

3. Security
   - No RLS policy changes. Existing policies cover the new columns automatically.

4. Notes
   - All columns are additive with safe defaults, so existing rows are unaffected.
   - Per-entry Batha data already stored on `invoice_billing_lines`/`invoice_items`
     for previously-created invoices is left untouched - this only changes how
     NEW invoices collect and store this charge going forward.
*/

DO $$ BEGIN
  ALTER TABLE invoices ADD COLUMN IF NOT EXISTS operator_batha_enabled boolean NOT NULL DEFAULT false;
  ALTER TABLE invoices ADD COLUMN IF NOT EXISTS operator_batha_rate numeric NOT NULL DEFAULT 0;
  ALTER TABLE invoices ADD COLUMN IF NOT EXISTS operator_batha_quantity numeric NOT NULL DEFAULT 0;
END $$;
