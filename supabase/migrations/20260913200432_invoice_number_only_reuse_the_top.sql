/*
# Invoice numbering: only reuse the top number, never reach into old gaps

## Problem with the previous version
next_pcs_invoice_number()/peek_pcs_invoice_number() searched for the LOWEST
unused number anywhere in the sequence. If old, long-standing gaps exist
(e.g. invoices 1-66 were deleted long ago, while 128 already exists today),
the very next invoice created gets "001" - jumping backward out of
chronological order, which is confusing and not appropriate for a GST
invoice sequence that's expected to trend with dates.

## Fix
Only ever reuse a number if it was the highest one and got deleted with
nothing higher created since - i.e. plain "current max + 1", computed fresh
from the real invoices table each time (not a separately-tracked counter).
This still satisfies the original ask (delete the invoice you just made a
mistake on, get the same number back on the redo) without ever reaching
backward into old, unrelated gaps.

## Reservation window
Still keep a short-lived reservation per number (via
pcs_invoice_number_reservations, added in a previous migration and now
required for any of this to work) to prevent two concurrent callers landing
on the same number before either one's own invoice INSERT completes.
Shortened the staleness window from 5 minutes to 15 seconds: the advisory
lock already fully serializes concurrent calls, so the reservation only
needs to cover the brief moment between "the RPC returned a number" and
"the caller's own immediate follow-up insert" - a normal delete-and-recreate
within a few minutes should reuse the top number right away, not wait
multiple minutes for it to become available again.
*/

CREATE OR REPLACE FUNCTION public.next_pcs_invoice_number(p_invoice_date text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fy text;
  next_num integer;
BEGIN
  fy := public.current_financial_year();

  PERFORM pg_advisory_xact_lock(hashtext('pcs_invoice_number:' || fy));

  DELETE FROM public.pcs_invoice_number_reservations
  WHERE reserved_at < now() - interval '15 seconds';

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
  ) + 1 INTO next_num;

  INSERT INTO public.pcs_invoice_number_reservations (financial_year, seq_number)
  VALUES (fy, next_num);

  RETURN 'PCS/' || fy || '/' || lpad(next_num::text, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.peek_pcs_invoice_number(p_invoice_date text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fy text;
  next_num integer;
BEGIN
  fy := public.current_financial_year();

  DELETE FROM public.pcs_invoice_number_reservations
  WHERE reserved_at < now() - interval '15 seconds';

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
  ) + 1 INTO next_num;

  RETURN 'PCS/' || fy || '/' || lpad(next_num::text, 3, '0');
END;
$$;
