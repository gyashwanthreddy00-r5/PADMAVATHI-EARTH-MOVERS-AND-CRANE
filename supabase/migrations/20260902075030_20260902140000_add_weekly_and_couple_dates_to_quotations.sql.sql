/*
# Extend Quotations for Weekly Rate, Couple of Dates, and Date Range

## Purpose
Update the quotations module to support:
1. Weekly rate type on rate_master
2. Couple of Dates rate type requiring from_date/to_date on quotation_equipment
3. Updated rate_type constraint to allow 'Weekly' and 'Couple of Dates'

## Changes

### 1. rate_master — add weekly_rate
- weekly_rate (numeric, nullable) — rate per week

### 2. quotation_equipment — add from_date and to_date
- from_date (date, nullable) — used for Couple of Dates rate type
- to_date (date, nullable) — used for Couple of Dates rate type

### 3. quotation_equipment — update rate_type constraint
- Drop the existing CHECK constraint that only allows Hourly, Daily, Monthly, Couple Hours
- Add a new CHECK constraint allowing: Hourly, Daily, Weekly, Monthly, Couple of Dates, Couple Hours
- Keep 'Couple Hours' for backward compatibility with existing rows

## Security
- No new tables. RLS already enabled. No policy changes needed.
*/

-- 1. Add weekly_rate to rate_master
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rate_master' AND table_schema = 'public' AND column_name = 'weekly_rate') THEN
    ALTER TABLE public.rate_master ADD COLUMN weekly_rate numeric;
  END IF;
END $$;

-- 2. Add from_date and to_date to quotation_equipment
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'quotation_equipment' AND table_schema = 'public' AND column_name = 'from_date') THEN
    ALTER TABLE public.quotation_equipment ADD COLUMN from_date date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'quotation_equipment' AND table_schema = 'public' AND column_name = 'to_date') THEN
    ALTER TABLE public.quotation_equipment ADD COLUMN to_date date;
  END IF;
END $$;

-- 3. Update rate_type constraint on quotation_equipment
ALTER TABLE public.quotation_equipment DROP CONSTRAINT IF EXISTS quotation_equipment_rate_type_check;
ALTER TABLE public.quotation_equipment ADD CONSTRAINT quotation_equipment_rate_type_check
  CHECK (rate_type = ANY (ARRAY['Hourly'::text, 'Daily'::text, 'Weekly'::text, 'Monthly'::text, 'Couple of Dates'::text, 'Couple Hours'::text]));
