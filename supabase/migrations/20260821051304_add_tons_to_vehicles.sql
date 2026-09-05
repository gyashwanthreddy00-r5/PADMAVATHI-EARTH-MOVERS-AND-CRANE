/*
# Add Tons/Capacity numeric column to vehicles table

1. Changes
- Adds `tons` (numeric, nullable) column to the `vehicles` table.
- This stores the vehicle's capacity in tons as a number (e.g. 10, 14, 20) for clean filtering.
- Existing `capacity` text column remains unchanged for backward compatibility.
- Backfills `tons` from existing `capacity` text values where possible (e.g. "14 Ton" -> 14).
- JCB vehicles get their tons value set from existing capacity or left null for user to fill in.

2. Security
- No RLS policy changes needed — vehicles table already has policies.
- No new tables created.

3. Notes
- The `tons` column is nullable so existing vehicles without capacity data are not broken.
- Users can update tons via Vehicle Master at any time.
- The `capacity` text column is preserved for existing rate-matching logic.
*/

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tons numeric(10,2);

-- Backfill tons from capacity text where possible (e.g. "14 Ton" -> 14, "30 Ton" -> 30)
UPDATE vehicles
SET tons = CAST(regexp_replace(capacity, '[^0-9.]', '', 'g') AS numeric)
WHERE capacity IS NOT NULL
  AND capacity != ''
  AND regexp_replace(capacity, '[^0-9.]', '', 'g') != ''
  AND tons IS NULL;

-- Create index for faster filtering by type + tons + active
CREATE INDEX IF NOT EXISTS idx_vehicles_type_tons_active ON vehicles (type, tons, active) WHERE active = true;
