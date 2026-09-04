/*
# Add service_amount_enabled column to quotations

1. Changes
- Adds `service_amount_enabled` boolean column to `quotations` table, defaulting to `true`.
- This allows the Service Amount to be toggled ON/OFF per quotation, similar to up/down transportation.
- When OFF, the Service Amount is excluded from calculations and not shown in any output.

2. Security
- No RLS policy changes. Existing policies remain unchanged.

3. Notes
- Default is `true` so all existing quotations behave as before (Service Amount was always included).
- The column is nullable-safe with a NOT NULL default.
*/

ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS service_amount_enabled boolean NOT NULL DEFAULT true;
