/*
# Shared Invoice Number: Always Reuse the Lowest Available Number

## Problem
`next_pcs_invoice_number()` (shared by GST invoices, Cash/UPI bills, and Monthly
Contract invoices — see calls in GstBillingEntry.tsx, Invoices.tsx, CashBills.tsx,
Contracts.tsx) previously drove a single monotonically-increasing counter
(`pcs_invoice_counter.last_number`). Deleting an invoice never freed its number:
if PCS/.../122 was deleted, the next invoice still became .../123, permanently
burning numbers and leaving gaps in the sequence.

## Fix
Replace the blind "increment a counter" approach with a real lowest-available-
number search over the `invoices` table itself: before issuing a number, find
the smallest positive integer N such that 'PCS/<FY>/<NNN>' does not already
exist as an invoice_number for the current financial year. Gaps left by
deleted invoices are naturally reused; the sequence never resets on deletion.

Both Cash/UPI and GST (and Monthly Contract) invoices already shared this one
function and one `invoices` table, so they automatically continue to share one
number space here too — no per-module change needed.

## Concurrency safety
Scanning `invoices` for the lowest gap and then having the caller separately
INSERT the new invoice row (the existing call pattern in every caller) leaves a
check-then-act race: two callers could both see the same gap as free before
either one's invoice row exists. A small reservation table
(`pcs_invoice_number_reservations`) closes this window — the number is reserved
the moment it's issued, and every call is serialized per financial year with a
transaction-scoped advisory lock so two concurrent callers can never receive
the same number. Reservations older than 5 minutes are swept automatically
(covers the rare case where the RPC succeeds but the caller's own invoice
insert then fails) — no caller needs to explicitly release anything.

## Format
Unchanged: PCS/<financial year>/<3-digit sequence>, e.g. PCS/2026-27/007.
`current_financial_year()` (Apr-Mar Indian financial year) is untouched.

## Data safety
No existing invoice is renumbered, modified, or deleted. Only how the NEXT
number is chosen changes.
*/

-- Tracks numbers that have been issued (via next_pcs_invoice_number) but whose
-- invoice row may not have been created yet - closes the check-then-act race
-- between "find the lowest free number" and the caller's own INSERT INTO
-- invoices. Rows are swept once stale (see next_pcs_invoice_number) or become
-- redundant once the real invoice row exists, whichever comes first.
CREATE TABLE IF NOT EXISTS public.pcs_invoice_number_reservations (
  financial_year text NOT NULL,
  seq_number integer NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (financial_year, seq_number)
);

CREATE OR REPLACE FUNCTION public.next_pcs_invoice_number(p_invoice_date text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fy text;
  max_n integer;
  next_num integer;
BEGIN
  fy := public.current_financial_year();

  -- Serializes concurrent callers for this financial year - the lock is held
  -- for the rest of this transaction, so the gap-scan below and the
  -- reservation insert that follows it can never race against another call.
  PERFORM pg_advisory_xact_lock(hashtext('pcs_invoice_number:' || fy));

  -- Abandoned reservations (the RPC succeeded but the caller's own invoice
  -- insert never happened) are freed automatically after 5 minutes.
  DELETE FROM public.pcs_invoice_number_reservations
  WHERE reserved_at < now() - interval '5 minutes';

  SELECT GREATEST(
    COALESCE((
      SELECT MAX(CAST(split_part(invoice_number, '/', 3) AS integer))
      FROM public.invoices
      WHERE invoice_number LIKE 'PCS/' || fy || '/%'
        AND split_part(invoice_number, '/', 3) ~ '^[0-9]+$'
    ), 0),
    COALESCE((
      SELECT MAX(seq_number) FROM public.pcs_invoice_number_reservations WHERE financial_year = fy
    ), 0)
  ) + 1 INTO max_n;

  SELECT MIN(gs.n) INTO next_num
  FROM generate_series(1, max_n) AS gs(n)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.invoice_number = 'PCS/' || fy || '/' || lpad(gs.n::text, 3, '0')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.pcs_invoice_number_reservations r
    WHERE r.financial_year = fy AND r.seq_number = gs.n
  );

  INSERT INTO public.pcs_invoice_number_reservations (financial_year, seq_number)
  VALUES (fy, next_num);

  RETURN 'PCS/' || fy || '/' || lpad(next_num::text, 3, '0');
END;
$$;

-- Preview-only variant (used to show the invoice number in the UI before the
-- first line is captured) - computes the same lowest-available number but
-- never reserves it, so opening/backing out of the billing screen never
-- burns a number.
CREATE OR REPLACE FUNCTION public.peek_pcs_invoice_number(p_invoice_date text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fy text;
  max_n integer;
  next_num integer;
BEGIN
  fy := public.current_financial_year();

  SELECT GREATEST(
    COALESCE((
      SELECT MAX(CAST(split_part(invoice_number, '/', 3) AS integer))
      FROM public.invoices
      WHERE invoice_number LIKE 'PCS/' || fy || '/%'
        AND split_part(invoice_number, '/', 3) ~ '^[0-9]+$'
    ), 0),
    COALESCE((
      SELECT MAX(seq_number) FROM public.pcs_invoice_number_reservations WHERE financial_year = fy
    ), 0)
  ) + 1 INTO max_n;

  SELECT MIN(gs.n) INTO next_num
  FROM generate_series(1, max_n) AS gs(n)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.invoice_number = 'PCS/' || fy || '/' || lpad(gs.n::text, 3, '0')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.pcs_invoice_number_reservations r
    WHERE r.financial_year = fy AND r.seq_number = gs.n
  );

  RETURN 'PCS/' || fy || '/' || lpad(next_num::text, 3, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_pcs_invoice_number(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_pcs_invoice_number(text) TO anon;
GRANT EXECUTE ON FUNCTION public.peek_pcs_invoice_number(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.peek_pcs_invoice_number(text) TO anon;
