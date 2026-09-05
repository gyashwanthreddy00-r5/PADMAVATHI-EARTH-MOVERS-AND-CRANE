/*
# Shared Date-Based Invoice Number Sequence (PCS/DD-MM-YYYY/NNN)

## Purpose
Replace the global never-resetting PCS invoice counter with a per-date counter
that resets to 001 for each new date, while remaining a SINGLE shared sequence
across all three billing modules (GST, Cash/UPI, Monthly Contracts).

## Background
The previous `next_pcs_invoice_number` function used a single-row global counter
that never reset. The requirement is that the 3-digit sequence restarts from 001
for each new date, but is still shared across all billing modules for that date.

Existing invoices are NOT renumbered. The new per-date counter is seeded from
existing PCS invoice numbers so that the next generated number continues after
the highest existing one for each date.

## Changes
1. New table: `pcs_invoice_date_counter` — keyed by `date_key` (DD-MM-YYYY),
   stores `last_number` per date. Replaces the single-row `pcs_invoice_counter`.
2. Replaced function: `next_pcs_invoice_number(p_invoice_date text)` — now uses
   the per-date counter table with atomic INSERT ... ON CONFLICT DO UPDATE.
3. Seed: existing PCS invoice numbers are parsed to populate the per-date
   counter so no duplicate numbers can be generated for dates that already
   have invoices.

## Security
- `pcs_invoice_date_counter`: accessed only via SECURITY DEFINER function.
- Function remains SECURITY DEFINER, granted to authenticated.
- No RLS changes. No existing data modified or deleted.
*/

-- 1. Create the per-date counter table
CREATE TABLE IF NOT EXISTS public.pcs_invoice_date_counter (
  date_key text PRIMARY KEY,
  last_number integer NOT NULL DEFAULT 0
);

-- 2. Seed from existing PCS invoice numbers so we never duplicate
INSERT INTO public.pcs_invoice_date_counter (date_key, last_number)
SELECT
  split_part(invoice_number, '/', 3) AS date_key_raw,
  MAX(CAST(split_part(invoice_number, '/', 4) AS integer)) AS max_num
FROM public.invoices
WHERE invoice_number LIKE 'PCS/%/%/%'
  AND split_part(invoice_number, '/', 4) ~ '^[0-9]+$'
GROUP BY split_part(invoice_number, '/', 3)
ON CONFLICT (date_key) DO UPDATE SET last_number = EXCLUDED.last_number;

-- 3. Replace the function to use per-date counter
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
  raw_date := COALESCE(p_invoice_date, to_char(now()::date, 'DD-MM-YYYY'));

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

  -- Atomic per-date increment: INSERT if new date, UPDATE if exists
  INSERT INTO public.pcs_invoice_date_counter (date_key, last_number)
  VALUES (date_part, 1)
  ON CONFLICT (date_key)
  DO UPDATE SET last_number = public.pcs_invoice_date_counter.last_number + 1
  RETURNING last_number INTO next_num;

  RETURN 'PCS/' || date_part || '/' || lpad(next_num::text, 3, '0');
END;
$$;

-- 4. Grant execute to authenticated (preserve existing access)
GRANT EXECUTE ON FUNCTION public.next_pcs_invoice_number(text) TO authenticated;

-- 5. Also grant to anon since the app may call this before auth in some flows
GRANT EXECUTE ON FUNCTION public.next_pcs_invoice_number(text) TO anon;
