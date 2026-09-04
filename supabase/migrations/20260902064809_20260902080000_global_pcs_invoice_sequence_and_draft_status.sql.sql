/*
# Global PCS Invoice Sequence + Draft Status for Captured Trips

## Purpose
1. Create an atomic, persistent, GLOBAL counter for PCS-format invoice numbers (PCS/DD-MM-YYYY/NNN).
   The 3-digit sequence is a running counter across ALL invoices regardless of date.
   It does NOT reset per day or per year.

2. Allow invoices to be saved as "Draft" (captured trips without invoice numbers).
   - invoice_number column is made nullable (if not already).
   - 'Draft' added to the invoice_status check constraint.

3. The next_pcs_invoice_number function accepts an invoice_date parameter (DD-MM-YYYY or ISO date)
   and returns PCS/<date>/NNN using the global counter.

## Changes
- New table: `pcs_invoice_counter` (single-row counter table).
- New function: `next_pcs_invoice_number(p_invoice_date text)` — atomic, SECURITY DEFINER.
- Modified: `invoices.invoice_status` check constraint to include 'Draft'.
- Modified: `invoices.invoice_number` made nullable (if not already).

## Security
- pcs_invoice_counter: no direct RLS needed (only accessed via SECURITY DEFINER function).
- Function is SECURITY DEFINER so it can modify the counter table regardless of caller role.
*/

-- 1. Create the global PCS invoice counter table (single row)
CREATE TABLE IF NOT EXISTS public.pcs_invoice_counter (
  id integer PRIMARY KEY DEFAULT 1,
  last_number integer NOT NULL DEFAULT 0,
  CONSTRAINT single_row CHECK (id = 1)
);

-- Ensure exactly one row exists
INSERT INTO public.pcs_invoice_counter (id, last_number)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

-- 2. Create the atomic next_pcs_invoice_number function
CREATE OR REPLACE FUNCTION public.next_pcs_invoice_number(p_invoice_date text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_num integer;
  date_part text;
  parsed_date date;
  raw_date text;
BEGIN
  -- Determine the date portion for the invoice number
  raw_date := COALESCE(p_invoice_date, to_char(now()::date, 'DD-MM-YYYY'));

  -- Try to parse the date. Accept DD-MM-YYYY or ISO YYYY-MM-DD.
  BEGIN
    parsed_date := to_date(raw_date, 'DD-MM-YYYY');
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      parsed_date := to_date(raw_date, 'YYYY-MM-DD');
    EXCEPTION WHEN OTHERS THEN
      parsed_date := now()::date;
    END;
  END;

  date_part := to_char(parsed_date, 'DD-MM-YYYY');

  -- Atomically increment the global counter
  UPDATE public.pcs_invoice_counter
  SET last_number = last_number + 1
  WHERE id = 1
  RETURNING last_number INTO next_num;

  IF next_num IS NULL THEN
    -- Row doesn't exist (shouldn't happen due to INSERT above), create it
    INSERT INTO public.pcs_invoice_counter (id, last_number) VALUES (1, 1)
    ON CONFLICT (id) DO UPDATE SET last_number = pcs_invoice_counter.last_number + 1
    RETURNING last_number INTO next_num;
  END IF;

  RETURN 'PCS/' || date_part || '/' || lpad(next_num::text, 3, '0');
END;
$$;

-- 3. Make invoice_number nullable (if not already)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoices'
      AND column_name = 'invoice_number'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.invoices ALTER COLUMN invoice_number DROP NOT NULL;
  END IF;
END $$;

-- 4. Replace invoice_status check constraint to include 'Draft'
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_invoice_status_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_invoice_status_check
  CHECK (invoice_status IN ('Draft', 'Pending', 'Generated', 'Partially Paid', 'Paid', 'Cancelled'));
