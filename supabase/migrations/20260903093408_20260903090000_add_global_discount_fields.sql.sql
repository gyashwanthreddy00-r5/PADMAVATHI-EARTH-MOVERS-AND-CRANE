/*
# Add Global Discount Fields

## Summary
Adds discount support to invoices, quotations, and monthly_contracts tables.
A discount is a percentage deduction from the GRAND TOTAL (after GST).
Default is OFF (discount_enabled = false).

## New Columns on `invoices`
- discount_enabled (boolean, default false) — whether discount is active
- discount_percent (numeric, default 0) — percentage of grand total to discount
- discount_amount (numeric, default 0) — calculated discount amount
- final_payable_amount (numeric, default 0) — grand_total minus discount_amount

## New Columns on `quotations`
- discount_enabled (boolean, default false)
- discount_percent (numeric, default 0)
- discount_amount (numeric, default 0)
- final_payable_amount (numeric, default 0)

## New Columns on `monthly_contracts`
- discount_enabled (boolean, default false)
- discount_percent (numeric, default 0)
- discount_amount (numeric, default 0)
- final_payable_amount (numeric, default 0)

## Notes
1. All columns have safe defaults so existing rows are unaffected.
2. Existing records will have discount_enabled=false, discount_amount=0,
   and final_payable_amount equal to grand_total (for invoices/quotations)
   or total_monthly_amount (for contracts).
3. No RLS policy changes needed — existing policies cover the new columns.
*/

DO $$ BEGIN
  ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_enabled boolean NOT NULL DEFAULT false;
  ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_percent numeric NOT NULL DEFAULT 0;
  ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0;
  ALTER TABLE invoices ADD COLUMN IF NOT EXISTS final_payable_amount numeric NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE quotations ADD COLUMN IF NOT EXISTS discount_enabled boolean NOT NULL DEFAULT false;
  ALTER TABLE quotations ADD COLUMN IF NOT EXISTS discount_percent numeric NOT NULL DEFAULT 0;
  ALTER TABLE quotations ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0;
  ALTER TABLE quotations ADD COLUMN IF NOT EXISTS final_payable_amount numeric NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE monthly_contracts ADD COLUMN IF NOT EXISTS discount_enabled boolean NOT NULL DEFAULT false;
  ALTER TABLE monthly_contracts ADD COLUMN IF NOT EXISTS discount_percent numeric NOT NULL DEFAULT 0;
  ALTER TABLE monthly_contracts ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0;
  ALTER TABLE monthly_contracts ADD COLUMN IF NOT EXISTS final_payable_amount numeric NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Backfill final_payable_amount for existing rows where it defaults to 0
UPDATE invoices SET final_payable_amount = grand_total WHERE final_payable_amount = 0 AND grand_total > 0;
UPDATE quotations SET final_payable_amount = grand_total WHERE final_payable_amount = 0 AND grand_total > 0;
UPDATE monthly_contracts SET final_payable_amount = total_monthly_amount WHERE final_payable_amount = 0 AND total_monthly_amount > 0;
