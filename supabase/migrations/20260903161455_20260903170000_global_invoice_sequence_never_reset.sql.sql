/*
# Global Invoice Number Sequence (Never Resets)

## Purpose
Replace the per-date counter with a single GLOBAL counter that never resets
across dates. The 3-digit sequence continues globally across all billing
modules (GST, Cash/UPI, Monthly Contracts) and all dates.

Also add a `peek_pcs_invoice_number` function that returns the NEXT number
that WOULD be generated, WITHOUT consuming it. This is used for previewing
the invoice number in the UI before the bill is saved.

## Background
The previous migration created a per-date counter that reset to 001 for each
new date. The requirement is that the sequence NEVER resets — it continues
globally. E.g. PCS/03-09-2026/005 → PCS/03-09-2026/006 → PCS/04-09-2026/007.

## Changes
1. Recreate `pcs_invoice_counter` table as single-row global counter (id=1).
2. Seed it with the highest existing sequence number across ALL PCS invoices.
3. Replace `next_pcs_invoice_number` to use the global counter (date only
   affects the date portion, not the sequence number).
4. New function `peek_pcs_invoice_number(p_invoice_date text)` — returns the
   next number WITHOUT incrementing. Used for UI preview.
5. Grant both functions to authenticated and anon.

## Security
- Counter table accessed only via SECURITY DEFINER functions.
- Both functions are SECURITY DEFINER.
- No RLS changes. No existing data modified or deleted.
*/

-- 1. Ensure the single-row global counter table exists
CREATE TABLE IF NOT EXISTS public.pcs_invoice_counter (
  id integer PRIMARY KEY DEFAULT 1,
  last_number integer NOT NULL DEFAULT 0,
  CONSTRAINT single_row CHECK (id = 1)
);

-- Ensure exactly one row exists
INSERT INTO public.pcs_invoice_counter (id, last_number)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

-- 2. Seed the global counter with the highest existing PCS sequence number
--    across ALL invoices regardless of date.
UPDATE public.pcs_invoice_counter
SET last_number = GREATEST(
  last_number,
  COALESCE((
    SELECT MAX(CAST(split_part(invoice_number, '/', 4) AS integer))
    FROM public.invoices
    WHERE invoice_number LIKE 'PCS/%/%/%'
      AND split_part(invoice_number, '/', 4) ~ '^[0-9]+$'
  ), 0)
)
WHERE id = 1;

-- 3. Replace next_pcs_invoice_number to use GLOBAL counter (date only affects display)
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

  -- Atomically increment the GLOBAL counter (never resets)
  UPDATE public.pcs_invoice_counter
  SET last_number = last_number + 1
  WHERE id = 1
  RETURNING last_number INTO next_num;

  IF next_num IS NULL THEN
    INSERT INTO public.pcs_invoice_counter (id, last_number) VALUES (1, 1)
    ON CONFLICT (id) DO UPDATE SET last_number = pcs_invoice_counter.last_number + 1
    RETURNING last_number INTO next_num;
  END IF;

  RETURN 'PCS/' || date_part || '/' || lpad(next_num::text, 3, '0');
END;
$$;

-- 4. New peek function — returns next number WITHOUT consuming it
CREATE OR REPLACE FUNCTION public.peek_pcs_invoice_number(p_invoice_date text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_num integer;
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

  SELECT last_number INTO current_num FROM public.pcs_invoice_counter WHERE id = 1;
  IF current_num IS NULL THEN
    current_num := 0;
  END IF;

  RETURN 'PCS/' || date_part || '/' || lpad((current_num + 1)::text, 3, '0');
END;
$$;

-- 5. Grant both functions
GRANT EXECUTE ON FUNCTION public.next_pcs_invoice_number(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_pcs_invoice_number(text) TO anon;
GRANT EXECUTE ON FUNCTION public.peek_pcs_invoice_number(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.peek_pcs_invoice_number(text) TO anon;
