/*
# Add trip field storage to invoices

## Summary
Adds columns to the `invoices` table so that Cash Bills and GST Bills can store
the full set of selected trip details (not just a few fields). This ensures no
trip data is lost when creating or editing bills.

## Changes
### invoices (ALTER - additive only)
- `trip_date` (date) — date of the trip
- `driver_name` (text) — driver/operator name from the trip
- `place_of_work` (text) — place of work from the trip
- `opening_hour_meter` (numeric) — opening hour meter reading
- `closing_hour_meter` (numeric) — closing hour meter reading
- `total_hours` (numeric) — total hours worked
- `rate_type` (text) — rate type (Hourly, Daily, etc.)
- `batha` already exists on invoices; no change needed.

All columns are nullable so existing invoice rows are unaffected.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='trip_date') THEN
    ALTER TABLE invoices ADD COLUMN trip_date date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='driver_name') THEN
    ALTER TABLE invoices ADD COLUMN driver_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='place_of_work') THEN
    ALTER TABLE invoices ADD COLUMN place_of_work text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='opening_hour_meter') THEN
    ALTER TABLE invoices ADD COLUMN opening_hour_meter numeric(12,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='closing_hour_meter') THEN
    ALTER TABLE invoices ADD COLUMN closing_hour_meter numeric(12,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='total_hours') THEN
    ALTER TABLE invoices ADD COLUMN total_hours numeric(12,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='rate_type') THEN
    ALTER TABLE invoices ADD COLUMN rate_type text;
  END IF;
END $$;