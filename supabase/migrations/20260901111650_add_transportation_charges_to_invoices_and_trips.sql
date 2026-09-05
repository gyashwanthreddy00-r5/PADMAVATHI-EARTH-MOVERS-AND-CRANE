/*
# Add UP/DOWN Transportation Charges to Invoices and Trips

1. Purpose
   - Add optional UP and DOWN transportation charge fields to both invoices and trips tables.
   - These are user-entered flat amounts (not auto-calculated).
   - They flow into the taxable amount for GST calculation.

2. New Columns on `invoices`
   - `up_transportation_enabled` (boolean, default false) — whether UP transportation was applied
   - `up_transportation_amount` (numeric, default 0) — the UP transportation charge
   - `down_transportation_enabled` (boolean, default false) — whether DOWN transportation was applied
   - `down_transportation_amount` (numeric, default 0) — the DOWN transportation charge

3. New Columns on `trips`
   - `up_transportation_enabled` (boolean, default false)
   - `up_transportation_amount` (numeric, default 0)
   - `down_transportation_enabled` (boolean, default false)
   - `down_transportation_amount` (numeric, default 0)

4. Security
   - No RLS policy changes. Existing policies cover the new columns automatically.

5. Notes
   - All columns are additive with safe defaults, so existing rows are unaffected.
   - The transportation amounts are included in taxable_amount when enabled.
*/

DO $$ BEGIN
  ALTER TABLE invoices ADD COLUMN IF NOT EXISTS up_transportation_enabled boolean NOT NULL DEFAULT false;
  ALTER TABLE invoices ADD COLUMN IF NOT EXISTS up_transportation_amount numeric NOT NULL DEFAULT 0;
  ALTER TABLE invoices ADD COLUMN IF NOT EXISTS down_transportation_enabled boolean NOT NULL DEFAULT false;
  ALTER TABLE invoices ADD COLUMN IF NOT EXISTS down_transportation_amount numeric NOT NULL DEFAULT 0;
END $$;

DO $$ BEGIN
  ALTER TABLE trips ADD COLUMN IF NOT EXISTS up_transportation_enabled boolean NOT NULL DEFAULT false;
  ALTER TABLE trips ADD COLUMN IF NOT EXISTS up_transportation_amount numeric NOT NULL DEFAULT 0;
  ALTER TABLE trips ADD COLUMN IF NOT EXISTS down_transportation_enabled boolean NOT NULL DEFAULT false;
  ALTER TABLE trips ADD COLUMN IF NOT EXISTS down_transportation_amount numeric NOT NULL DEFAULT 0;
END $$;
