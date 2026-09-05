/*
# Rate Master Versioning + Trip Rate Snapshots

## Summary
Redesigns the Rate Master to use capacity-based, versioned pricing with historical rate protection.
Old `rates` table is left in place (not dropped) for backward compatibility but the new `rate_master`
table becomes the source of truth. Trip entries now store a rate snapshot so changing Rate Master
never affects historical transactions.

## 1. New Table: rate_master
- `id` (uuid PK)
- `vehicle_category` (text NOT NULL) — display label e.g. "12 Ton", "14 Ton", "F15", "30 Ton", "55 Ton", "80 Ton"
- `capacity_tons` (text NULL) — numeric capacity in tons or category label for non-ton vehicles (e.g. "F15")
- `rate_type` (text NOT NULL, CHECK in 'Hourly','Daily','Both') — pricing model
- `first_hour_rate` (numeric NULL) — 1st hour rate (NULL for daily-only categories)
- `second_hour_rate` (numeric NULL) — 2nd hour rate (NULL for daily-only categories)
- `daily_rate` (numeric NOT NULL DEFAULT 0) — daily rental rate
- `batha` (numeric NOT NULL DEFAULT 0) — driver/operator allowance
- `effective_from` (date NOT NULL) — when this version becomes active
- `effective_to` (date NULL) — when this version ends (NULL = currently active)
- `status` (text NOT NULL DEFAULT 'Active', CHECK in 'Active','Inactive','Closed') — lifecycle status
- `version_number` (integer NOT NULL DEFAULT 1) — increments per category on edit
- `created_at`, `updated_at` (timestamptz defaults)
- `created_by`, `updated_by` (uuid FK auth.users, nullable)

## 2. Trip Rate Snapshot Columns (ALTER trips)
- `rate_master_id` (uuid NULL) — references rate_master(id) at time of trip
- `rate_version` (integer NULL) — version_number snapshot
- `capacity_tons` (text NULL) — capacity snapshot for reporting
- `first_hour_rate` (numeric NULL) — rate snapshot
- `second_hour_rate` (numeric NULL) — rate snapshot
- `daily_rate_snapshot` (numeric NULL) — rate snapshot (named _snapshot to avoid clash with existing columns)
- `batha_snapshot` (numeric NULL) — batha rate snapshot

## 3. Seed Data
Inserts 8 initial rate configurations as V1, all effective from 2026-08-20, effective_to NULL:
12 Ton, 14 Ton, 16 Ton, 17 Ton, F15, 30 Ton, 55 Ton, 80 Ton.

## 4. Security
- RLS enabled on rate_master
- 4 policies (SELECT/INSERT/UPDATE/DELETE) for authenticated users
*/

-- ============================================================
-- 1. Create rate_master table
-- ============================================================
CREATE TABLE IF NOT EXISTS rate_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_category text NOT NULL,
  capacity_tons text,
  rate_type text NOT NULL DEFAULT 'Both' CHECK (rate_type IN ('Hourly','Daily','Both')),
  first_hour_rate numeric,
  second_hour_rate numeric,
  daily_rate numeric NOT NULL DEFAULT 0,
  batha numeric NOT NULL DEFAULT 0,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive','Closed')),
  version_number integer NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE rate_master ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_rate_master" ON rate_master;
CREATE POLICY "auth_select_rate_master" ON rate_master FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_rate_master" ON rate_master;
CREATE POLICY "auth_insert_rate_master" ON rate_master FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_rate_master" ON rate_master;
CREATE POLICY "auth_update_rate_master" ON rate_master FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_delete_rate_master" ON rate_master;
CREATE POLICY "auth_delete_rate_master" ON rate_master FOR DELETE
  TO authenticated USING (true);

-- Index for finding active rate by category on a given date
CREATE INDEX IF NOT EXISTS idx_rate_master_category_dates
  ON rate_master (vehicle_category, effective_from, effective_to);

-- ============================================================
-- 2. Add rate snapshot columns to trips
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='trips' AND column_name='rate_master_id') THEN
    ALTER TABLE trips ADD COLUMN rate_master_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='trips' AND column_name='rate_version') THEN
    ALTER TABLE trips ADD COLUMN rate_version integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='trips' AND column_name='capacity_tons') THEN
    ALTER TABLE trips ADD COLUMN capacity_tons text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='trips' AND column_name='first_hour_rate') THEN
    ALTER TABLE trips ADD COLUMN first_hour_rate numeric;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='trips' AND column_name='second_hour_rate') THEN
    ALTER TABLE trips ADD COLUMN second_hour_rate numeric;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='trips' AND column_name='daily_rate_snapshot') THEN
    ALTER TABLE trips ADD COLUMN daily_rate_snapshot numeric;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='trips' AND column_name='batha_snapshot') THEN
    ALTER TABLE trips ADD COLUMN batha_snapshot numeric;
  END IF;
END $$;

-- Add FK for rate_master_id (non-blocking, fails gracefully if duplicates exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trips_rate_master_id_fkey') THEN
    ALTER TABLE trips ADD CONSTRAINT trips_rate_master_id_fkey
      FOREIGN KEY (rate_master_id) REFERENCES rate_master(id);
  END IF;
END $$;

-- ============================================================
-- 3. Seed initial rate data (idempotent — only if table is empty)
-- ============================================================
INSERT INTO rate_master (vehicle_category, capacity_tons, rate_type, first_hour_rate, second_hour_rate, daily_rate, batha, effective_from, effective_to, status, version_number)
SELECT * FROM (VALUES
  ('12 Ton',  '12',  'Both', 1800::numeric, 800::numeric,  6500::numeric,  200::numeric, '2026-08-20'::date, NULL::date, 'Active', 1),
  ('14 Ton',  '14',  'Both', 2000::numeric, 800::numeric,  7500::numeric,  200::numeric, '2026-08-20'::date, NULL::date, 'Active', 1),
  ('16 Ton',  '16',  'Both', 2500::numeric, 1000::numeric, 10000::numeric, 200::numeric, '2026-08-20'::date, NULL::date, 'Active', 1),
  ('17 Ton',  '17',  'Both', 3000::numeric, 1200::numeric, 11500::numeric, 200::numeric, '2026-08-20'::date, NULL::date, 'Active', 1),
  ('F15',     'F15', 'Daily', NULL::numeric, NULL::numeric, 10500::numeric, 500::numeric, '2026-08-20'::date, NULL::date, 'Active', 1),
  ('30 Ton',  '30',  'Daily', NULL::numeric, NULL::numeric, 22000::numeric, 1000::numeric,'2026-08-20'::date, NULL::date, 'Active', 1),
  ('55 Ton',  '55',  'Daily', NULL::numeric, NULL::numeric, 27000::numeric, 1000::numeric,'2026-08-20'::date, NULL::date, 'Active', 1),
  ('80 Ton',  '80',  'Daily', NULL::numeric, NULL::numeric, 42000::numeric, 1000::numeric,'2026-08-20'::date, NULL::date, 'Active', 1)
) AS v(vehicle_category, capacity_tons, rate_type, first_hour_rate, second_hour_rate, daily_rate, batha, effective_from, effective_to, status, version_number)
WHERE NOT EXISTS (SELECT 1 FROM rate_master LIMIT 1);
