/*
# Diesel Module: Purchase vs Distribution Separation

## Purpose
Separates diesel purchasing (stock entry) from diesel distribution (giving diesel to vehicles).
Previously, diesel_entries combined both concepts and required vehicle selection at purchase time.
Now purchases are stock-only, and a new diesel_distributions table tracks how purchased stock
is distributed to individual vehicles.

## Changes

### 1. New Table: diesel_distributions
Tracks each instance of diesel given from company stock to a specific vehicle.
- id (uuid, PK)
- distribution_date (date, NOT NULL) — when diesel was given to the vehicle
- vehicle_id (uuid, FK to vehicles, NOT NULL) — which vehicle received the diesel
- purchase_id (uuid, FK to diesel_entries, nullable) — which purchase this distribution came from
- quantity_liters (numeric, NOT NULL) — liters given to this vehicle
- rate_per_liter (numeric, NOT NULL) — fuel rate snapshot from the purchase
- amount (numeric, NOT NULL) — quantity_liters × rate_per_liter
- remarks (text, nullable)
- is_cancelled (boolean, default false) — soft delete
- created_by (uuid, nullable)
- created_at (timestamptz, default now())
- updated_at (timestamptz, default now())
- updated_by (uuid, nullable)

### 2. Existing Table: diesel_entries (unchanged schema)
No columns added or removed. The vehicle_id column remains for backward compatibility
with existing records, but new purchase entries will set vehicle_id to NULL (stock purchase).
Existing records with vehicle_id are treated as legacy data.

### 3. Security
- Enable RLS on diesel_distributions.
- Add 4 CRUD policies (SELECT/INSERT/UPDATE/DELETE) for authenticated users,
  matching the existing diesel_entries policy pattern.
*/

CREATE TABLE IF NOT EXISTS diesel_distributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_date date NOT NULL DEFAULT CURRENT_DATE,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE SET NULL,
  purchase_id uuid REFERENCES diesel_entries(id) ON DELETE SET NULL,
  quantity_liters numeric NOT NULL DEFAULT 0,
  rate_per_liter numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  remarks text,
  is_cancelled boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by uuid
);

ALTER TABLE diesel_distributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_diesel_dist" ON diesel_distributions;
CREATE POLICY "auth_select_diesel_dist" ON diesel_distributions FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_diesel_dist" ON diesel_distributions;
CREATE POLICY "auth_insert_diesel_dist" ON diesel_distributions FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_diesel_dist" ON diesel_distributions;
CREATE POLICY "auth_update_diesel_dist" ON diesel_distributions FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_delete_diesel_dist" ON diesel_distributions;
CREATE POLICY "auth_delete_diesel_dist" ON diesel_distributions FOR DELETE
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_diesel_dist_vehicle ON diesel_distributions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_diesel_dist_date ON diesel_distributions(distribution_date);
CREATE INDEX IF NOT EXISTS idx_diesel_dist_purchase ON diesel_distributions(purchase_id);
