/*
# Enable RLS on invoice/quotation counter tables

## Security issue
pcs_invoice_counter, pcs_invoice_date_counter, and quotation_counter never
had Row Level Security enabled, unlike every other table in this database.
Confirmed live: an unauthenticated request using only the public anon key
could read the real current invoice sequence number with zero login.

## Fix
Enable RLS and add the same "must be logged in" policy shape already used
by every other table in this app (TO authenticated USING (true) WITH CHECK
(true)). This only requires being authenticated - it does not add any
per-user ownership restriction, matching how the rest of the database
already works today. No application code needs to change.
*/

ALTER TABLE public.pcs_invoice_counter ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_access" ON public.pcs_invoice_counter;
CREATE POLICY "authenticated_access" ON public.pcs_invoice_counter
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.pcs_invoice_date_counter ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_access" ON public.pcs_invoice_date_counter;
CREATE POLICY "authenticated_access" ON public.pcs_invoice_date_counter
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.quotation_counter ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_access" ON public.quotation_counter;
CREATE POLICY "authenticated_access" ON public.quotation_counter
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
