/*
# Extend Quotations Module and Rate Master

## Purpose
Update the quotations system to support:
1. Separate Reference No. and Subject fields (instead of combined reference_subject)
2. Multiple other charges (stored as JSON array)
3. Minimum hours and minimum charge on rate_master for hourly rate enforcement

## Changes

### 1. rate_master — add minimum_hours and minimum_charge
- minimum_hours (numeric, nullable) — e.g. 3 means minimum 3 hours for hourly rate
- minimum_charge (numeric, nullable) — flat minimum charge when hours < minimum_hours

### 2. quotations — add reference_no, subject, other_charges_json
- reference_no (text, nullable) — customer reference number
- subject (text, nullable) — quotation subject line
- other_charges_json (jsonb, nullable) — array of {description, amount} objects for multiple other charges
- The existing reference_subject column is kept for backward compatibility (not dropped)

## Security
- No new tables. RLS already enabled on both tables. No policy changes needed.
*/

-- 1. Add minimum_hours and minimum_charge to rate_master
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rate_master' AND table_schema = 'public' AND column_name = 'minimum_hours') THEN
    ALTER TABLE public.rate_master ADD COLUMN minimum_hours numeric;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rate_master' AND table_schema = 'public' AND column_name = 'minimum_charge') THEN
    ALTER TABLE public.rate_master ADD COLUMN minimum_charge numeric;
  END IF;
END $$;

-- 2. Add reference_no, subject, other_charges_json to quotations
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'quotations' AND table_schema = 'public' AND column_name = 'reference_no') THEN
    ALTER TABLE public.quotations ADD COLUMN reference_no text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'quotations' AND table_schema = 'public' AND column_name = 'subject') THEN
    ALTER TABLE public.quotations ADD COLUMN subject text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'quotations' AND table_schema = 'public' AND column_name = 'other_charges_json') THEN
    ALTER TABLE public.quotations ADD COLUMN other_charges_json jsonb;
  END IF;
END $$;
