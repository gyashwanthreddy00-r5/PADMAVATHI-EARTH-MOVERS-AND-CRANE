/*
# Performance: index missing foreign keys, fix profiles RLS re-evaluation

## Summary
Supabase's performance advisor flagged two categories of findings on the
production database - neither is a functional bug, both are purely
internal database optimizations with zero effect on app behavior or UI.

## 1. Unindexed foreign keys (39 columns)
A foreign key column with no index makes joins and cascading
deletes/updates through that relationship slower than necessary as the
referencing table grows. Purely additive - `IF NOT EXISTS` so this is
safe to run even if a name happens to already exist.

## 2. RLS policies re-evaluating auth.uid() per row
`profiles_select_own` and `profiles_update_own` call `auth.uid()` directly
in their USING/WITH CHECK clause, which Postgres re-evaluates once per row
scanned. Wrapping it as `(select auth.uid())` lets Postgres evaluate it
once per query instead - same access rules, same result set, just cheaper
at scale.

## Data safety
No data is modified. No existing index or policy is dropped - only new
indexes are added and the two existing policies are redefined with the
same logical condition, rewritten for performance.
*/

CREATE INDEX IF NOT EXISTS idx_attendance_created_by ON public.attendance (created_by);
CREATE INDEX IF NOT EXISTS idx_customers_created_by ON public.customers (created_by);
CREATE INDEX IF NOT EXISTS idx_customers_updated_by ON public.customers (updated_by);
CREATE INDEX IF NOT EXISTS idx_diesel_entries_created_by ON public.diesel_entries (created_by);
CREATE INDEX IF NOT EXISTS idx_diesel_entries_updated_by ON public.diesel_entries (updated_by);
CREATE INDEX IF NOT EXISTS idx_emi_records_created_by ON public.emi_records (created_by);
CREATE INDEX IF NOT EXISTS idx_emi_records_updated_by ON public.emi_records (updated_by);
CREATE INDEX IF NOT EXISTS idx_employees_created_by ON public.employees (created_by);
CREATE INDEX IF NOT EXISTS idx_employees_updated_by ON public.employees (updated_by);
CREATE INDEX IF NOT EXISTS idx_invoice_billing_lines_vehicle_id ON public.invoice_billing_lines (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_trip_entry_id ON public.invoice_items (trip_entry_id);
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_customer_id ON public.invoice_reminders (customer_id);
CREATE INDEX IF NOT EXISTS idx_invoice_vehicles_driver_id ON public.invoice_vehicles (driver_id);
CREATE INDEX IF NOT EXISTS idx_invoice_vehicles_vehicle_id ON public.invoice_vehicles (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created_by ON public.invoices (created_by);
CREATE INDEX IF NOT EXISTS idx_invoices_trip_id ON public.invoices (trip_id);
CREATE INDEX IF NOT EXISTS idx_invoices_updated_by ON public.invoices (updated_by);
CREATE INDEX IF NOT EXISTS idx_invoices_vehicle_id ON public.invoices (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_created_by ON public.maintenance (created_by);
CREATE INDEX IF NOT EXISTS idx_maintenance_updated_by ON public.maintenance (updated_by);
CREATE INDEX IF NOT EXISTS idx_monthly_contracts_created_by ON public.monthly_contracts (created_by);
CREATE INDEX IF NOT EXISTS idx_monthly_contracts_updated_by ON public.monthly_contracts (updated_by);
CREATE INDEX IF NOT EXISTS idx_po_working_records_vehicle_id ON public.po_working_records (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_quotation_email_history_quotation_id ON public.quotation_email_history (quotation_id);
CREATE INDEX IF NOT EXISTS idx_rate_master_created_by ON public.rate_master (created_by);
CREATE INDEX IF NOT EXISTS idx_rate_master_updated_by ON public.rate_master (updated_by);
CREATE INDEX IF NOT EXISTS idx_rates_created_by ON public.rates (created_by);
CREATE INDEX IF NOT EXISTS idx_rates_updated_by ON public.rates (updated_by);
CREATE INDEX IF NOT EXISTS idx_role_pages_page_id ON public.role_pages (page_id);
CREATE INDEX IF NOT EXISTS idx_salary_advance_recoveries_created_by ON public.salary_advance_recoveries (created_by);
CREATE INDEX IF NOT EXISTS idx_salary_advances_created_by ON public.salary_advances (created_by);
CREATE INDEX IF NOT EXISTS idx_salary_advances_updated_by ON public.salary_advances (updated_by);
CREATE INDEX IF NOT EXISTS idx_trips_created_by ON public.trips (created_by);
CREATE INDEX IF NOT EXISTS idx_trips_customer_id ON public.trips (customer_id);
CREATE INDEX IF NOT EXISTS idx_trips_rate_master_id ON public.trips (rate_master_id);
CREATE INDEX IF NOT EXISTS idx_trips_updated_by ON public.trips (updated_by);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON public.user_roles (role_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_created_by ON public.vehicles (created_by);
CREATE INDEX IF NOT EXISTS idx_vehicles_updated_by ON public.vehicles (updated_by);

ALTER POLICY profiles_select_own ON public.profiles
  USING ((select auth.uid()) = id);

ALTER POLICY profiles_update_own ON public.profiles
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);
