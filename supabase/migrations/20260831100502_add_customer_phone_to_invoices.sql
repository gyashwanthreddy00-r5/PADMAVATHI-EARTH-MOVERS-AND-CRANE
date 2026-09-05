/*
# Add customer_phone column to invoices

1. Changes to existing tables:
   - `invoices`: add `customer_phone` text column (nullable) to store customer phone at invoice creation time
     This complements the existing `customer_email` column added in a prior migration.

2. Important notes:
   - Column is nullable so existing invoice records are unaffected.
   - No data is lost or transformed.
*/

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS customer_phone text;
