/*
# Maintenance Management Module — Schema Extension

1. New Tables
- `maintenance_types`: configurable maintenance categories managed from Settings.
  - `id` (uuid, PK)
  - `name` (text, unique, not null) — e.g. "Batteries", "Tyres / Tyre Maintenance"
  - `is_active` (boolean, default true) — admin can deactivate
  - `sort_order` (int, default 0) — ordering for display
  - `created_at`, `updated_at` (timestamps)

2. Modified Tables
- `maintenance`: added columns to support the new Maintenance Management Module:
  - `paid_amount` (numeric, default 0) — amount already paid
  - `balance` (numeric, default 0) — remaining balance (total_amount − paid_amount)
  - `remark` (text, nullable) — replaces/extends description for the "Remark" column
  The existing `amount` column is renamed semantically to represent "Total Amount" but the column name stays `amount` to avoid data loss. `description` is kept for backward compatibility. `maintenance_type` stays as text so existing records are not lost.

3. Seed Data
- Seven initial maintenance types: Batteries, Tyres / Tyre Maintenance, Electric Work, Automobile Items, Belts / Recycles, Oil / Grease / Lubricants, Other Maintenance.

4. Security
- Enable RLS on `maintenance_types`.
- CRUD policies for `authenticated` role (the app has a sign-in screen).
- Existing `maintenance` table RLS policies remain unchanged (already allow authenticated CRUD).

5. Important Notes
  1. Existing maintenance records are preserved. New columns get safe defaults.
  2. Deactivating a maintenance type does NOT delete or modify existing maintenance records — the type name is stored as text on each record.
  3. The `maintenance_type` column on `maintenance` is plain text (not a FK) so historical records remain valid even if a type is later deactivated or removed from Settings.
*/

-- ============================================================
-- 1. Create maintenance_types table
-- ============================================================
CREATE TABLE IF NOT EXISTS maintenance_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE maintenance_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_maintenance_types" ON maintenance_types;
CREATE POLICY "auth_select_maintenance_types" ON maintenance_types FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_maintenance_types" ON maintenance_types;
CREATE POLICY "auth_insert_maintenance_types" ON maintenance_types FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_maintenance_types" ON maintenance_types;
CREATE POLICY "auth_update_maintenance_types" ON maintenance_types FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_delete_maintenance_types" ON maintenance_types;
CREATE POLICY "auth_delete_maintenance_types" ON maintenance_types FOR DELETE
  TO authenticated USING (true);

-- ============================================================
-- 2. Add columns to maintenance table (idempotent)
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'maintenance' AND column_name = 'paid_amount') THEN
    ALTER TABLE maintenance ADD COLUMN paid_amount numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'maintenance' AND column_name = 'balance') THEN
    ALTER TABLE maintenance ADD COLUMN balance numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'maintenance' AND column_name = 'remark') THEN
    ALTER TABLE maintenance ADD COLUMN remark text;
  END IF;
END $$;

-- Backfill balance for existing rows: balance = amount - paid_amount
UPDATE maintenance SET balance = amount - COALESCE(paid_amount, 0) WHERE balance = 0 AND amount > 0;

-- ============================================================
-- 3. Seed initial maintenance types (idempotent)
-- ============================================================
INSERT INTO maintenance_types (name, sort_order, is_active)
VALUES
  ('Batteries', 1, true),
  ('Tyres / Tyre Maintenance', 2, true),
  ('Electric Work', 3, true),
  ('Automobile Items', 4, true),
  ('Belts / Recycles', 5, true),
  ('Oil / Grease / Lubricants', 6, true),
  ('Other Maintenance', 7, true)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 4. Index for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_maintenance_types_active_sort ON maintenance_types (is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_maintenance_date ON maintenance (maintenance_date);
CREATE INDEX IF NOT EXISTS idx_maintenance_vehicle ON maintenance (vehicle_id);