/*
# Quotations — share across all authenticated users (not just the creator)

## Root cause of "data not visible to other users"
Audited every RLS policy in the database (pg_policies) for user-scoped
predicates. Every business table already uses `TO authenticated USING
(true)` — fully shared, exactly as this app already behaves everywhere
else (trips, diesel_entries, maintenance, attendance_records, purchases,
vendors, invoices, invoice_items, invoice_payments, monthly_contracts,
po_orders, po_working_records, customers, vehicles, employees,
emi_records, salary_advances, invoice_billing_lines, invoice_vehicles,
invoice_vehicle_sessions, reminder tables, etc.) — EXCEPT `quotations` and
`quotation_equipment`, which were deliberately scoped to
`auth.uid() = created_by` when that module was first built (see
20260902070915_..._create_quotations_module.sql.sql, "Security" note).
That is the one real instance of the per-creator data silo described.

## Fix
Replace those 8 owner-only policies with the same `USING (true)` /
`WITH CHECK (true)` shape already used by every other table, so any
authenticated user can see, create, update, and delete any quotation —
consistent with how every other module in this application already
works. Policy names are kept identical (DROP + CREATE, not renamed) so
nothing else needs to change.

`quotation_counter`, `next_quotation_number()`, and every other table are
untouched. No data is moved, copied, or deleted — existing quotation rows
become visible to other users purely because the access check changes;
the rows themselves are not modified.
*/

DROP POLICY IF EXISTS "select_own_quotations" ON public.quotations;
CREATE POLICY "select_own_quotations" ON public.quotations FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_own_quotations" ON public.quotations;
CREATE POLICY "insert_own_quotations" ON public.quotations FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_own_quotations" ON public.quotations;
CREATE POLICY "update_own_quotations" ON public.quotations FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_own_quotations" ON public.quotations;
CREATE POLICY "delete_own_quotations" ON public.quotations FOR DELETE
  TO authenticated USING (true);

DROP POLICY IF EXISTS "select_own_quotation_equipment" ON public.quotation_equipment;
CREATE POLICY "select_own_quotation_equipment" ON public.quotation_equipment FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_own_quotation_equipment" ON public.quotation_equipment;
CREATE POLICY "insert_own_quotation_equipment" ON public.quotation_equipment FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_own_quotation_equipment" ON public.quotation_equipment;
CREATE POLICY "update_own_quotation_equipment" ON public.quotation_equipment FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_own_quotation_equipment" ON public.quotation_equipment;
CREATE POLICY "delete_own_quotation_equipment" ON public.quotation_equipment FOR DELETE
  TO authenticated USING (true);
