/*
# Replace "Couple Hours" with "Weekly" in rate_type constraints

## Purpose
The application is renaming the "Couple Hours" rate type to "Weekly" across the UI,
calculations, and billing logic. This migration updates all database CHECK constraints
to reflect the new allowed values.

## Changes

### trips table
- Updated `rate_type` CHECK constraint to allow: 'Hourly', 'Daily', 'Weekly', 'Monthly'
- Removed 'Couple Hours' from allowed values

### rate_master table
- Updated `rate_type` CHECK constraint to allow: 'Hourly', 'Daily', 'Both', 'Weekly', 'Monthly'
- Removed 'Couple Hours' from allowed values

### quotation_equipment table
- Updated `rate_type` CHECK constraint to allow: 'Hourly', 'Daily', 'Weekly', 'Monthly', 'Couple of Dates'
- Removed 'Couple Hours' from allowed values

### Data migration
- Updated existing rows with `rate_type = 'Couple Hours'` to `rate_type = 'Weekly'` in all three tables

## Notes
- No columns are dropped or renamed (column rename was done in a prior migration)
- No data is lost — existing 'Couple Hours' rows are reclassified as 'Weekly'
- Constraints are dropped and recreated to update allowed values
*/

-- Update existing data from 'Couple Hours' to 'Weekly'
UPDATE trips SET rate_type = 'Weekly' WHERE rate_type = 'Couple Hours';
UPDATE rate_master SET rate_type = 'Weekly' WHERE rate_type = 'Couple Hours';
UPDATE quotation_equipment SET rate_type = 'Weekly' WHERE rate_type = 'Couple Hours';

-- Recreate trips_rate_type_check
ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_rate_type_check;
ALTER TABLE trips ADD CONSTRAINT trips_rate_type_check
  CHECK (rate_type = ANY (ARRAY['Hourly'::text, 'Daily'::text, 'Weekly'::text, 'Monthly'::text]));

-- Recreate rate_master_rate_type_check
ALTER TABLE rate_master DROP CONSTRAINT IF EXISTS rate_master_rate_type_check;
ALTER TABLE rate_master ADD CONSTRAINT rate_master_rate_type_check
  CHECK (rate_type = ANY (ARRAY['Hourly'::text, 'Daily'::text, 'Both'::text, 'Weekly'::text, 'Monthly'::text]));

-- Recreate quotation_equipment_rate_type_check
ALTER TABLE quotation_equipment DROP CONSTRAINT IF EXISTS quotation_equipment_rate_type_check;
ALTER TABLE quotation_equipment ADD CONSTRAINT quotation_equipment_rate_type_check
  CHECK (rate_type = ANY (ARRAY['Hourly'::text, 'Daily'::text, 'Weekly'::text, 'Monthly'::text, 'Couple of Dates'::text]));
