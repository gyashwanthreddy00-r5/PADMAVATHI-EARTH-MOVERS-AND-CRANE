/*
# Extend Rate Master for JCB support and extended hourly rates

## Summary
Adds vehicle_type, 3rd/4th/5th hour rates, couple_hours_rate, and monthly_rate to the rate_master table.
Adds corresponding snapshot columns to trips for historical rate preservation.
Adds vehicle_type column to rate_master to distinguish Crane vs JCB rates.

## Changes to rate_master table
- vehicle_type text DEFAULT 'Crane' — 'Crane' or 'JCB'
- third_hour_rate numeric — 3rd hour rate
- fourth_hour_rate numeric — 4th hour rate
- fifth_hour_rate numeric — 5th hour rate
- couple_hours_rate numeric — couple hours rate
- monthly_rate numeric — monthly rental rate

## Changes to trips table
- third_hour_rate_snapshot numeric — 3rd hour rate snapshot
- fourth_hour_rate_snapshot numeric — 4th hour rate snapshot
- fifth_hour_rate_snapshot numeric — 5th hour rate snapshot
- couple_hours_rate_snapshot numeric — couple hours rate snapshot
- monthly_rate_snapshot numeric — monthly rate snapshot

## Security
- No RLS policy changes — existing policies remain intact.
- No data loss — all new columns are nullable/optional.

## Important Notes
1. All new columns are nullable to preserve existing records.
2. vehicle_type defaults to 'Crane' so existing rate_master rows are treated as Crane rates.
3. Trip snapshot columns allow future trips to store full rate details at creation time.
4. Existing trips remain unchanged — their snapshot columns will be NULL.
*/

-- Add vehicle_type and extended rate columns to rate_master
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rate_master' AND column_name='vehicle_type') THEN
    ALTER TABLE rate_master ADD COLUMN vehicle_type text DEFAULT 'Crane';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rate_master' AND column_name='third_hour_rate') THEN
    ALTER TABLE rate_master ADD COLUMN third_hour_rate numeric;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rate_master' AND column_name='fourth_hour_rate') THEN
    ALTER TABLE rate_master ADD COLUMN fourth_hour_rate numeric;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rate_master' AND column_name='fifth_hour_rate') THEN
    ALTER TABLE rate_master ADD COLUMN fifth_hour_rate numeric;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rate_master' AND column_name='couple_hours_rate') THEN
    ALTER TABLE rate_master ADD COLUMN couple_hours_rate numeric;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rate_master' AND column_name='monthly_rate') THEN
    ALTER TABLE rate_master ADD COLUMN monthly_rate numeric;
  END IF;
END $$;

-- Add extended rate snapshot columns to trips
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='trips' AND column_name='third_hour_rate_snapshot') THEN
    ALTER TABLE trips ADD COLUMN third_hour_rate_snapshot numeric;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='trips' AND column_name='fourth_hour_rate_snapshot') THEN
    ALTER TABLE trips ADD COLUMN fourth_hour_rate_snapshot numeric;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='trips' AND column_name='fifth_hour_rate_snapshot') THEN
    ALTER TABLE trips ADD COLUMN fifth_hour_rate_snapshot numeric;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='trips' AND column_name='couple_hours_rate_snapshot') THEN
    ALTER TABLE trips ADD COLUMN couple_hours_rate_snapshot numeric;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='trips' AND column_name='monthly_rate_snapshot') THEN
    ALTER TABLE trips ADD COLUMN monthly_rate_snapshot numeric;
  END IF;
END $$;

-- Update the rate_type CHECK constraint to include 'Couple Hours' and 'Monthly'
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='rate_master_rate_type_check' AND table_name='rate_master') THEN
    ALTER TABLE rate_master DROP CONSTRAINT rate_master_rate_type_check;
  END IF;
END $$;
ALTER TABLE rate_master ADD CONSTRAINT rate_master_rate_type_check CHECK (rate_type IN ('Hourly','Daily','Both','Couple Hours','Monthly'));
