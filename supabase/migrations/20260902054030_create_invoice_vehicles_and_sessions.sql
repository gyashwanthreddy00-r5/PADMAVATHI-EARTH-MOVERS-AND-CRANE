/*
# Create invoice_vehicles and invoice_vehicle_sessions tables

## Purpose
Support multiple vehicles/equipment under a single bill/entry (both Cash/UPI and GST/Company Billing).
Previously, one invoice/trip entry could only have one vehicle. This migration adds the
hierarchical structure: Invoice → Multiple Invoice Vehicles → Multiple Sessions per Vehicle.

## New Tables

### 1. invoice_vehicles
Stores per-vehicle data linked to an invoice.
- `id` (uuid, PK)
- `invoice_id` (uuid, FK to invoices, NOT NULL, CASCADE on delete)
- `vehicle_id` (uuid, FK to vehicles, nullable — allows ad-hoc vehicles)
- `vehicle_number` (text, nullable — denormalized for display)
- `vehicle_type` (text, nullable — 'Crane' | 'JCB' | 'Truck')
- `capacity` (text, nullable — tons/capacity label)
- `driver_id` (uuid, FK to employees, nullable)
- `driver_name` (text, nullable — denormalized)
- `place_of_work` (text, nullable — per-vehicle place of work for GST)
- `rate_type` (text, nullable — 'Hourly' | 'Daily' | 'Monthly' | 'Couple Hours')
- `total_hours` (numeric, default 0 — sum of all session durations)
- `rental_amount` (numeric, default 0 — calculated rental for this vehicle)
- `batha` (numeric, default 0 — operator batha for this vehicle)
- `vehicle_total` (numeric, default 0 — rental + batha for this vehicle)
- `rate_master_id` (uuid, nullable — snapshot reference)
- `rate_version` (integer, nullable — snapshot version)
- `capacity_tons` (text, nullable — snapshot)
- `first_hour_rate` (numeric, nullable — snapshot)
- `second_hour_rate` (numeric, nullable — snapshot)
- `third_hour_rate_snapshot` (numeric, nullable — snapshot)
- `fourth_hour_rate_snapshot` (numeric, nullable — snapshot)
- `fifth_hour_rate_snapshot` (numeric, nullable — snapshot)
- `couple_hours_rate_snapshot` (numeric, nullable — snapshot)
- `daily_rate_snapshot` (numeric, nullable — snapshot)
- `monthly_rate_snapshot` (numeric, nullable — snapshot)
- `batha_snapshot` (numeric, nullable — snapshot)
- `sort_order` (integer, default 0 — display order)
- `created_at` (timestamptz, default now())
- `updated_at` (timestamptz, default now())

### 2. invoice_vehicle_sessions
Stores per-session data linked to an invoice_vehicle.
- `id` (uuid, PK)
- `invoice_vehicle_id` (uuid, FK to invoice_vehicles, NOT NULL, CASCADE on delete)
- `session_number` (integer, default 1)
- `in_time` (timestamptz, nullable)
- `out_time` (timestamptz, nullable)
- `opening_hour_meter` (numeric, nullable)
- `closing_hour_meter` (numeric, nullable)
- `duration_minutes` (integer, default 0)
- `remarks` (text, nullable)
- `created_at` (timestamptz, default now())
- `updated_at` (timestamptz, default now())

## Security
- Enable RLS on both tables.
- Policies follow the existing app pattern: authenticated users get full CRUD (USING true / WITH CHECK true),
  matching all other tables in this schema.
- 4 separate policies per table (SELECT, INSERT, UPDATE, DELETE).

## Backward Compatibility
- Existing invoices with trip_id remain unchanged.
- New multi-vehicle invoices will use invoice_vehicles instead of trips.
- No existing data is modified or deleted.

## Indexes
- invoice_vehicles: invoice_id (frequent lookup by invoice)
- invoice_vehicle_sessions: invoice_vehicle_id (frequent lookup by vehicle)
*/

-- ============================================================
-- 1. invoice_vehicles table
-- ============================================================
CREATE TABLE IF NOT EXISTS invoice_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  vehicle_number text,
  vehicle_type text,
  capacity text,
  driver_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  driver_name text,
  place_of_work text,
  rate_type text,
  total_hours numeric DEFAULT 0,
  rental_amount numeric DEFAULT 0,
  batha numeric DEFAULT 0,
  vehicle_total numeric DEFAULT 0,
  rate_master_id uuid,
  rate_version integer,
  capacity_tons text,
  first_hour_rate numeric,
  second_hour_rate numeric,
  third_hour_rate_snapshot numeric,
  fourth_hour_rate_snapshot numeric,
  fifth_hour_rate_snapshot numeric,
  couple_hours_rate_snapshot numeric,
  daily_rate_snapshot numeric,
  monthly_rate_snapshot numeric,
  batha_snapshot numeric,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE invoice_vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_invoice_vehicles" ON invoice_vehicles;
CREATE POLICY "auth_select_invoice_vehicles" ON invoice_vehicles FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_invoice_vehicles" ON invoice_vehicles;
CREATE POLICY "auth_insert_invoice_vehicles" ON invoice_vehicles FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_invoice_vehicles" ON invoice_vehicles;
CREATE POLICY "auth_update_invoice_vehicles" ON invoice_vehicles FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_delete_invoice_vehicles" ON invoice_vehicles;
CREATE POLICY "auth_delete_invoice_vehicles" ON invoice_vehicles FOR DELETE
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_invoice_vehicles_invoice_id ON invoice_vehicles(invoice_id);

-- ============================================================
-- 2. invoice_vehicle_sessions table
-- ============================================================
CREATE TABLE IF NOT EXISTS invoice_vehicle_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_vehicle_id uuid NOT NULL REFERENCES invoice_vehicles(id) ON DELETE CASCADE,
  session_number integer DEFAULT 1,
  in_time timestamptz,
  out_time timestamptz,
  opening_hour_meter numeric,
  closing_hour_meter numeric,
  duration_minutes integer DEFAULT 0,
  remarks text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE invoice_vehicle_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_invoice_vehicle_sessions" ON invoice_vehicle_sessions;
CREATE POLICY "auth_select_invoice_vehicle_sessions" ON invoice_vehicle_sessions FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_invoice_vehicle_sessions" ON invoice_vehicle_sessions;
CREATE POLICY "auth_insert_invoice_vehicle_sessions" ON invoice_vehicle_sessions FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_invoice_vehicle_sessions" ON invoice_vehicle_sessions;
CREATE POLICY "auth_update_invoice_vehicle_sessions" ON invoice_vehicle_sessions FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_delete_invoice_vehicle_sessions" ON invoice_vehicle_sessions;
CREATE POLICY "auth_delete_invoice_vehicle_sessions" ON invoice_vehicle_sessions FOR DELETE
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_invoice_vehicle_sessions_vehicle_id ON invoice_vehicle_sessions(invoice_vehicle_id);

-- ============================================================
-- 3. updated_at triggers (matching existing pattern)
-- ============================================================
CREATE OR REPLACE FUNCTION update_invoice_vehicles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_vehicles_updated_at ON invoice_vehicles;
CREATE TRIGGER trg_invoice_vehicles_updated_at
  BEFORE UPDATE ON invoice_vehicles
  FOR EACH ROW EXECUTE FUNCTION update_invoice_vehicles_updated_at();

CREATE OR REPLACE FUNCTION update_invoice_vehicle_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_vehicle_sessions_updated_at ON invoice_vehicle_sessions;
CREATE TRIGGER trg_invoice_vehicle_sessions_updated_at
  BEFORE UPDATE ON invoice_vehicle_sessions
  FOR EACH ROW EXECUTE FUNCTION update_invoice_vehicle_sessions_updated_at();
