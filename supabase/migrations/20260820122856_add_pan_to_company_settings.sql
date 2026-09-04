/*
# Add PAN field to Company Settings

1. Modified Tables
- `company_settings`: Add `pan` text column (nullable) to store the company PAN number.
2. Security
- No security changes. Existing RLS policies remain unchanged.
3. Notes
- PAN is optional, so the column is nullable.
- No existing data is modified or deleted.
*/

ALTER TABLE company_settings
ADD COLUMN IF NOT EXISTS pan text;
