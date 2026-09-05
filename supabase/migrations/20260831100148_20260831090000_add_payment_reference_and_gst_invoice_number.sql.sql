/*
# Add payment reference column, customer email on invoices, and GST invoice number function

1. Changes to existing tables:
   - `invoice_payments`: add `reference` text column (nullable) for UPI Reference / Transaction ID
   - `invoices`: add `customer_email` text column (nullable) to store customer email at invoice creation time

2. New functions:
   - `next_gst_invoice_number()`: generates invoice numbers in format PCS/DD-MM-YYYY/NNN
     Uses a separate counter table `gst_invoice_counter` keyed by date string (DD-MM-YYYY)
     to ensure atomic, duplicate-free sequential numbering per day.

3. New tables:
   - `gst_invoice_counter`: counter table for GST invoice number generation
     - `date_key` (text, primary key) — format DD-MM-YYYY
     - `last_number` (integer) — last issued sequential number for that day

4. Security:
   - `gst_invoice_counter`: RLS enabled, all CRUD restricted to authenticated users
   - `next_gst_invoice_number` function: SECURITY DEFINER so it can update the counter
     table regardless of the caller's RLS policies

5. Important notes:
   - Existing `next_invoice_number` function is NOT modified — it continues to work for Cash bills
   - Existing invoice_payments and invoices data is untouched
   - The new `reference` column is nullable so existing payment records are unaffected
*/

-- 1. Add reference column to invoice_payments
ALTER TABLE invoice_payments
  ADD COLUMN IF NOT EXISTS reference text;

-- 2. Add customer_email column to invoices
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS customer_email text;

-- 3. Create gst_invoice_counter table
CREATE TABLE IF NOT EXISTS gst_invoice_counter (
  date_key text PRIMARY KEY,
  last_number integer NOT NULL DEFAULT 0
);

ALTER TABLE gst_invoice_counter ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_gst_invoice_counter" ON gst_invoice_counter;
CREATE POLICY "auth_select_gst_invoice_counter"
ON gst_invoice_counter FOR SELECT
TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_gst_invoice_counter" ON gst_invoice_counter;
CREATE POLICY "auth_insert_gst_invoice_counter"
ON gst_invoice_counter FOR INSERT
TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_gst_invoice_counter" ON gst_invoice_counter;
CREATE POLICY "auth_update_gst_invoice_counter"
ON gst_invoice_counter FOR UPDATE
TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_delete_gst_invoice_counter" ON gst_invoice_counter;
CREATE POLICY "auth_delete_gst_invoice_counter"
ON gst_invoice_counter FOR DELETE
TO authenticated USING (true);

-- 4. Create next_gst_invoice_number function
-- Generates: PCS/DD-MM-YYYY/NNN (e.g. PCS/31-08-2026/001)
CREATE OR REPLACE FUNCTION next_gst_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  date_key text := to_char(now(), 'DD-MM-YYYY');
  next_num integer;
  result text;
BEGIN
  INSERT INTO gst_invoice_counter (date_key, last_number)
  VALUES (date_key, 1)
  ON CONFLICT (date_key)
  DO UPDATE SET last_number = gst_invoice_counter.last_number + 1
  RETURNING last_number INTO next_num;

  result := 'PCS/' || date_key || '/' || lpad(next_num::text, 3, '0');
  RETURN result;
END;
$$;

-- Grant execute to authenticated
GRANT EXECUTE ON FUNCTION next_gst_invoice_number() TO authenticated;
