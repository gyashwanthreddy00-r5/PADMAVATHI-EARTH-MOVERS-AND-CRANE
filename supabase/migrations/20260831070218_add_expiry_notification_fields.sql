/*
# Expiry & Due Date Notification Fields

## Purpose
Adds eye test tracking fields for drivers in the employees table, and a fitness expiry date for vehicles. These fields power the ERP's notification system that alerts users about upcoming and expired documents/dates.

## Changes

### 1. employees table — new columns (all nullable, backward compatible)
- eye_test_amount numeric NULL — cost of the driver's eye test
- eye_test_date date NULL — when the eye test was conducted
- eye_test_expiry_date date NULL — when the eye test expires

### 2. vehicles table — new column (nullable, backward compatible)
- fitness_expiry_date date NULL — when the vehicle's fitness certificate expires

### 3. Security
No new tables. Existing RLS policies on employees and vehicles cover the new columns automatically.

### Notes
- All new columns are nullable so existing records remain valid without changes.
- No data migration needed — NULL means "not yet tracked."
*/
DO $$ BEGIN
  ALTER TABLE employees ADD COLUMN IF NOT EXISTS eye_test_amount numeric;
  ALTER TABLE employees ADD COLUMN IF NOT EXISTS eye_test_date date;
  ALTER TABLE employees ADD COLUMN IF NOT EXISTS eye_test_expiry_date date;
  ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fitness_expiry_date date;
END $$;
