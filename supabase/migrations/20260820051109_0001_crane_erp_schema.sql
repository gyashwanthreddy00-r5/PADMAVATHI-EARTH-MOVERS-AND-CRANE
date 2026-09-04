/*
# Crane & JCB Rental ERP - Complete Schema

## Overview
Creates the full production database for a Crane/JCB rental business ERP.
This is a single-tenant app WITH authentication: any signed-in user can access
all ERP data (shared business data). Unauthenticated users get nothing.

## New Tables (13)
1. vehicles - Crane/JCB master with EMI details, rates, status
2. employees - Drivers/operators/helpers with license tracking
3. rates - Slab-based hourly/daily/monthly rate master by vehicle type
4. customers - Companies/customers for billing (with GSTIN)
5. monthly_contracts - Full-time monthly rental contracts
6. trips - Main operational trip entries with auto-calculated billing
7. diesel_entries - Per-vehicle diesel transactions with payment tracking
8. attendance - Daily employee attendance (present/absent/holiday)
9. maintenance - Vehicle maintenance records
10. emi_records - Vehicle EMI payment tracking
11. invoices - Cash & GST bills generated from trips
12. company_settings - Single-row company config (batha, diesel rate, GST, invoice prefix)
13. invoice_counter - Sequential invoice numbering per year

## Security
- RLS enabled on every table.
- All policies scoped TO authenticated (sign-in required).
- USING (true) is correct here: data is intentionally shared among all ERP users
  in a single business. Unauthenticated (anon) users get no access.
- 4 policies per table (select/insert/update/delete).

## Indexes
- registration_number, trip_date, diesel_date, attendance_date,
  maintenance_date, invoice_number, due_date, vehicle_id, driver_id

## Notes
- Soft delete via is_cancelled flag on financial tables (trips, diesel, invoices,
  maintenance, emi_records, attendance).
- Audit columns created_at/created_by/updated_at/updated_by on all tables.
- updated_at auto-maintained via trigger.
*/

-- ============================================================
-- Helper: updated_at trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- 1. vehicles
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number text UNIQUE NOT NULL,
  registration_number text UNIQUE NOT NULL,
  model text,
  type text NOT NULL DEFAULT 'Crane' CHECK (type IN ('Crane','JCB')),
  capacity text,
  emi_status text NOT NULL DEFAULT 'No EMI' CHECK (emi_status IN ('No EMI','EMI Applicable')),
  emi_amount numeric(12,2) DEFAULT 0,
  emi_due_date date,
  emi_start_date date,
  emi_end_date date,
  hourly_rate numeric(12,2) DEFAULT 0,
  daily_rate numeric(12,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'Available' CHECK (status IN ('Available','Working','Maintenance','Inactive')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_vehicles_registration ON public.vehicles(registration_number);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON public.vehicles(status);

DROP POLICY IF EXISTS "auth_select_vehicles" ON public.vehicles;
CREATE POLICY "auth_select_vehicles" ON public.vehicles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_vehicles" ON public.vehicles;
CREATE POLICY "auth_insert_vehicles" ON public.vehicles FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_vehicles" ON public.vehicles;
CREATE POLICY "auth_update_vehicles" ON public.vehicles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_vehicles" ON public.vehicles;
CREATE POLICY "auth_delete_vehicles" ON public.vehicles FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_vehicles_updated BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 2. employees
-- ============================================================
CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text NOT NULL DEFAULT 'Driver' CHECK (role IN ('Driver','Operator','Helper','Other')),
  phone text,
  salary numeric(12,2) DEFAULT 0,
  license_number text,
  license_expiry date,
  advance_salary numeric(12,2) DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_employees_role ON public.employees(role);

DROP POLICY IF EXISTS "auth_select_employees" ON public.employees;
CREATE POLICY "auth_select_employees" ON public.employees FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_employees" ON public.employees;
CREATE POLICY "auth_insert_employees" ON public.employees FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_employees" ON public.employees;
CREATE POLICY "auth_update_employees" ON public.employees FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_employees" ON public.employees;
CREATE POLICY "auth_delete_employees" ON public.employees FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 3. rates
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('Crane','JCB','Both')),
  rate_type text NOT NULL DEFAULT 'Hourly' CHECK (rate_type IN ('Hourly','Daily','Monthly')),
  hour_1_rate numeric(12,2) DEFAULT 0,
  hour_2_rate numeric(12,2) DEFAULT 0,
  hour_3_rate numeric(12,2) DEFAULT 0,
  hour_4_rate numeric(12,2) DEFAULT 0,
  hour_5_rate numeric(12,2) DEFAULT 0,
  daily_rate numeric(12,2) DEFAULT 0,
  couple_hours_rate numeric(12,2) DEFAULT 0,
  monthly_rate numeric(12,2) DEFAULT 0,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.rates ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_rates_vehicle_type ON public.rates(vehicle_type);

DROP POLICY IF EXISTS "auth_select_rates" ON public.rates;
CREATE POLICY "auth_select_rates" ON public.rates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_rates" ON public.rates;
CREATE POLICY "auth_insert_rates" ON public.rates FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_rates" ON public.rates;
CREATE POLICY "auth_update_rates" ON public.rates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_rates" ON public.rates;
CREATE POLICY "auth_delete_rates" ON public.rates FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_rates_updated BEFORE UPDATE ON public.rates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. customers
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  phone text,
  email text,
  gstin text,
  billing_details text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_customers" ON public.customers;
CREATE POLICY "auth_select_customers" ON public.customers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_customers" ON public.customers;
CREATE POLICY "auth_insert_customers" ON public.customers FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_customers" ON public.customers;
CREATE POLICY "auth_update_customers" ON public.customers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_customers" ON public.customers;
CREATE POLICY "auth_delete_customers" ON public.customers FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 5. monthly_contracts
-- ============================================================
CREATE TABLE IF NOT EXISTS public.monthly_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  address text,
  billing_details text,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  start_date date NOT NULL,
  end_date date,
  budget numeric(12,2) DEFAULT 0,
  total_monthly_amount numeric(12,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Completed','Expired','Cancelled')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.monthly_contracts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_contracts_vehicle ON public.monthly_contracts(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON public.monthly_contracts(status);

DROP POLICY IF EXISTS "auth_select_contracts" ON public.monthly_contracts;
CREATE POLICY "auth_select_contracts" ON public.monthly_contracts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_contracts" ON public.monthly_contracts;
CREATE POLICY "auth_insert_contracts" ON public.monthly_contracts FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_contracts" ON public.monthly_contracts;
CREATE POLICY "auth_update_contracts" ON public.monthly_contracts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_contracts" ON public.monthly_contracts;
CREATE POLICY "auth_delete_contracts" ON public.monthly_contracts FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_contracts_updated BEFORE UPDATE ON public.monthly_contracts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 6. trips
-- ============================================================
CREATE TABLE IF NOT EXISTS public.trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_number text UNIQUE NOT NULL,
  trip_date date NOT NULL DEFAULT CURRENT_DATE,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  place_of_work text NOT NULL,
  rate_type text NOT NULL DEFAULT 'Hourly' CHECK (rate_type IN ('Hourly','Daily','Monthly','Couple Hours')),
  in_time timestamptz,
  out_time timestamptz,
  opening_hour_meter numeric(12,2),
  closing_hour_meter numeric(12,2),
  total_hours numeric(12,2) DEFAULT 0,
  rental_amount numeric(12,2) DEFAULT 0,
  batha numeric(12,2) DEFAULT 0,
  total_amount numeric(12,2) DEFAULT 0,
  bill_status text NOT NULL DEFAULT 'Pending' CHECK (bill_status IN ('Paid','Pending')),
  payment_mode text CHECK (payment_mode IN ('Cash','Online','Bank Transfer','Other')),
  payment_date date,
  remarks text,
  is_cancelled boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_trips_trip_date ON public.trips(trip_date);
CREATE INDEX IF NOT EXISTS idx_trips_vehicle ON public.trips(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_trips_driver ON public.trips(driver_id);
CREATE INDEX IF NOT EXISTS idx_trips_bill_status ON public.trips(bill_status);

DROP POLICY IF EXISTS "auth_select_trips" ON public.trips;
CREATE POLICY "auth_select_trips" ON public.trips FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_trips" ON public.trips;
CREATE POLICY "auth_insert_trips" ON public.trips FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_trips" ON public.trips;
CREATE POLICY "auth_update_trips" ON public.trips FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_trips" ON public.trips;
CREATE POLICY "auth_delete_trips" ON public.trips FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_trips_updated BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 7. diesel_entries
-- ============================================================
CREATE TABLE IF NOT EXISTS public.diesel_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diesel_date date NOT NULL DEFAULT CURRENT_DATE,
  pump_name text,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  quantity_liters numeric(12,2) NOT NULL DEFAULT 0 CHECK (quantity_liters > 0),
  rate_per_liter numeric(12,2) NOT NULL DEFAULT 0 CHECK (rate_per_liter >= 0),
  total_amount numeric(12,2) DEFAULT 0,
  paid_amount numeric(12,2) DEFAULT 0,
  pending_amount numeric(12,2) DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'Pending' CHECK (payment_status IN ('Paid','Pending')),
  remarks text,
  is_cancelled boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.diesel_entries ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_diesel_date ON public.diesel_entries(diesel_date);
CREATE INDEX IF NOT EXISTS idx_diesel_vehicle ON public.diesel_entries(vehicle_id);

DROP POLICY IF EXISTS "auth_select_diesel" ON public.diesel_entries;
CREATE POLICY "auth_select_diesel" ON public.diesel_entries FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_diesel" ON public.diesel_entries;
CREATE POLICY "auth_insert_diesel" ON public.diesel_entries FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_diesel" ON public.diesel_entries;
CREATE POLICY "auth_update_diesel" ON public.diesel_entries FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_diesel" ON public.diesel_entries;
CREATE POLICY "auth_delete_diesel" ON public.diesel_entries FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_diesel_updated BEFORE UPDATE ON public.diesel_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 8. attendance
-- ============================================================
CREATE TABLE IF NOT EXISTS public.attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_date date NOT NULL DEFAULT CURRENT_DATE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'Present' CHECK (status IN ('Present','Absent','Holiday')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  is_cancelled boolean NOT NULL DEFAULT false,
  UNIQUE (attendance_date, employee_id)
);
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_employee ON public.attendance(employee_id);

DROP POLICY IF EXISTS "auth_select_attendance" ON public.attendance;
CREATE POLICY "auth_select_attendance" ON public.attendance FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_attendance" ON public.attendance;
CREATE POLICY "auth_insert_attendance" ON public.attendance FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_attendance" ON public.attendance;
CREATE POLICY "auth_update_attendance" ON public.attendance FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_attendance" ON public.attendance;
CREATE POLICY "auth_delete_attendance" ON public.attendance FOR DELETE TO authenticated USING (true);

-- ============================================================
-- 9. maintenance
-- ============================================================
CREATE TABLE IF NOT EXISTS public.maintenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_date date NOT NULL DEFAULT CURRENT_DATE,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  maintenance_type text NOT NULL DEFAULT 'Repair' CHECK (maintenance_type IN ('Tyre','Repair','Others')),
  amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  description text,
  is_cancelled boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.maintenance ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_maintenance_date ON public.maintenance(maintenance_date);
CREATE INDEX IF NOT EXISTS idx_maintenance_vehicle ON public.maintenance(vehicle_id);

DROP POLICY IF EXISTS "auth_select_maintenance" ON public.maintenance;
CREATE POLICY "auth_select_maintenance" ON public.maintenance FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_maintenance" ON public.maintenance;
CREATE POLICY "auth_insert_maintenance" ON public.maintenance FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_maintenance" ON public.maintenance;
CREATE POLICY "auth_update_maintenance" ON public.maintenance FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_maintenance" ON public.maintenance;
CREATE POLICY "auth_delete_maintenance" ON public.maintenance FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_maintenance_updated BEFORE UPDATE ON public.maintenance
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 10. emi_records
-- ============================================================
CREATE TABLE IF NOT EXISTS public.emi_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  emi_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (emi_amount >= 0),
  due_date date NOT NULL,
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'Upcoming' CHECK (status IN ('Upcoming','Due','Paid','Overdue')),
  paid_date date,
  payment_mode text CHECK (payment_mode IN ('Cash','Online','Bank Transfer','Other')),
  remarks text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.emi_records ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_emi_vehicle ON public.emi_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_emi_due_date ON public.emi_records(due_date);
CREATE INDEX IF NOT EXISTS idx_emi_status ON public.emi_records(status);

DROP POLICY IF EXISTS "auth_select_emi" ON public.emi_records;
CREATE POLICY "auth_select_emi" ON public.emi_records FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_emi" ON public.emi_records;
CREATE POLICY "auth_insert_emi" ON public.emi_records FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_emi" ON public.emi_records;
CREATE POLICY "auth_update_emi" ON public.emi_records FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_emi" ON public.emi_records;
CREATE POLICY "auth_delete_emi" ON public.emi_records FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_emi_updated BEFORE UPDATE ON public.emi_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 11. invoices
-- ============================================================
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE NOT NULL,
  invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  invoice_type text NOT NULL DEFAULT 'Cash' CHECK (invoice_type IN ('Cash','GST')),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text,
  customer_address text,
  customer_gstin text,
  trip_id uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  vehicle_number text,
  description text,
  hours numeric(12,2),
  rate numeric(12,2),
  taxable_amount numeric(12,2) DEFAULT 0,
  cgst_percent numeric(5,2) DEFAULT 0,
  sgst_percent numeric(5,2) DEFAULT 0,
  igst_percent numeric(5,2) DEFAULT 0,
  cgst_amount numeric(12,2) DEFAULT 0,
  sgst_amount numeric(12,2) DEFAULT 0,
  igst_amount numeric(12,2) DEFAULT 0,
  total_gst numeric(12,2) DEFAULT 0,
  grand_total numeric(12,2) DEFAULT 0,
  batha numeric(12,2) DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'Pending' CHECK (payment_status IN ('Paid','Pending')),
  payment_mode text CHECK (payment_mode IN ('Cash','Online','Bank Transfer','Other')),
  is_cancelled boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_invoices_number ON public.invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON public.invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON public.invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_type ON public.invoices(invoice_type);

DROP POLICY IF EXISTS "auth_select_invoices" ON public.invoices;
CREATE POLICY "auth_select_invoices" ON public.invoices FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_invoices" ON public.invoices;
CREATE POLICY "auth_insert_invoices" ON public.invoices FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_invoices" ON public.invoices;
CREATE POLICY "auth_update_invoices" ON public.invoices FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_invoices" ON public.invoices;
CREATE POLICY "auth_delete_invoices" ON public.invoices FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_invoices_updated BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 12. company_settings (single row)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.company_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL DEFAULT 'Crane ERP',
  address text,
  phone text,
  email text,
  gstin text,
  logo_url text,
  bank_details text,
  default_batha numeric(12,2) NOT NULL DEFAULT 200,
  diesel_rate numeric(12,2) NOT NULL DEFAULT 95.50,
  invoice_prefix text NOT NULL DEFAULT 'INV',
  invoice_start_number integer NOT NULL DEFAULT 1,
  cgst_percent numeric(5,2) DEFAULT 9,
  sgst_percent numeric(5,2) DEFAULT 9,
  igst_percent numeric(5,2) DEFAULT 18,
  gst_enabled boolean NOT NULL DEFAULT true,
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en','te')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_settings" ON public.company_settings;
CREATE POLICY "auth_select_settings" ON public.company_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_settings" ON public.company_settings;
CREATE POLICY "auth_insert_settings" ON public.company_settings FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_settings" ON public.company_settings;
CREATE POLICY "auth_update_settings" ON public.company_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_settings" ON public.company_settings;
CREATE POLICY "auth_delete_settings" ON public.company_settings FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 13. invoice_counter (sequential numbering per year)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.invoice_counter (
  year integer PRIMARY KEY,
  last_number integer NOT NULL DEFAULT 0
);
ALTER TABLE public.invoice_counter ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_counter" ON public.invoice_counter;
CREATE POLICY "auth_select_counter" ON public.invoice_counter FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_counter" ON public.invoice_counter;
CREATE POLICY "auth_insert_counter" ON public.invoice_counter FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_counter" ON public.invoice_counter;
CREATE POLICY "auth_update_counter" ON public.invoice_counter FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- Function: generate next invoice number (atomic)
-- ============================================================
CREATE OR REPLACE FUNCTION public.next_invoice_number(prefix text DEFAULT 'INV')
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  yr integer := extract(year from now())::integer;
  next_num integer;
  result text;
BEGIN
  INSERT INTO public.invoice_counter (year, last_number)
  VALUES (yr, 1)
  ON CONFLICT (year)
  DO UPDATE SET last_number = public.invoice_counter.last_number + 1
  RETURNING last_number INTO next_num;
  result := prefix || '-' || yr::text || '-' || lpad(next_num::text, 5, '0');
  RETURN result;
END;
$$;

-- ============================================================
-- Function: generate next trip number (atomic)
-- ============================================================
CREATE OR REPLACE FUNCTION public.next_trip_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  yr integer := extract(year from now())::integer;
  next_num integer;
  result text;
BEGIN
  INSERT INTO public.invoice_counter (year, last_number)
  VALUES (yr, 1)
  ON CONFLICT (year)
  DO UPDATE SET last_number = public.invoice_counter.last_number + 1
  RETURNING last_number INTO next_num;
  result := 'TRP-' || yr::text || '-' || lpad(next_num::text, 5, '0');
  RETURN result;
END;
$$;

-- ============================================================
-- Seed default company settings row
-- ============================================================
INSERT INTO public.company_settings (company_name)
SELECT 'Crane ERP'
WHERE NOT EXISTS (SELECT 1 FROM public.company_settings);
