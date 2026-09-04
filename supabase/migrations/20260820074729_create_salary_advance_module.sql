/*
# Salary Advance Module — Transaction Tables

## Summary
Creates two new tables for proper salary advance tracking with recovery/deduction support.
Migrates existing static advance_salary values from employees into proper transactions.

## New Tables

### salary_advances
- id (uuid PK)
- employee_id (FK → employees, ON DELETE SET NULL)
- advance_date (date, not null)
- advance_reference (text, unique — e.g. ADV-001)
- advance_amount (numeric, not null, CHECK >= 0)
- reason (text)
- payment_mode (text — Cash/Bank Transfer/UPI/Other)
- reference_number (text)
- remarks (text)
- status (text — Outstanding/Partially Recovered/Fully Recovered, default Outstanding)
- created_at, updated_at (timestamptz)
- created_by, updated_by (FK → auth.users)

### salary_advance_recoveries
- id (uuid PK)
- salary_advance_id (FK → salary_advances, ON DELETE CASCADE)
- employee_id (FK → employees, ON DELETE SET NULL)
- recovery_date (date, not null)
- salary_month (text — e.g. "August 2026")
- recovery_amount (numeric, not null, CHECK >= 0)
- remarks (text)
- created_at, updated_at (timestamptz)
- created_by (FK → auth.users)

## Security
- RLS enabled on both tables.
- 4 CRUD policies each, scoped TO authenticated (app has sign-in).
- No data loss — existing employee advance_salary values are migrated into salary_advances rows.

## Migration of Existing Data
- For each employee with advance_salary > 0, insert a salary_advance record.
- Sai → ₹4,000, Baba → ₹3,000, Krishna → ₹8,000.
- Uses NOT EXISTS guard so re-running won't create duplicates.
*/

-- ============================================================
-- 1. salary_advances table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.salary_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  advance_date date NOT NULL DEFAULT CURRENT_DATE,
  advance_reference text UNIQUE NOT NULL,
  advance_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (advance_amount >= 0),
  reason text,
  payment_mode text CHECK (payment_mode IN ('Cash','Bank Transfer','UPI','Other')),
  reference_number text,
  remarks text,
  status text NOT NULL DEFAULT 'Outstanding' CHECK (status IN ('Outstanding','Partially Recovered','Fully Recovered')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.salary_advances ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_sa_employee ON public.salary_advances(employee_id);
CREATE INDEX IF NOT EXISTS idx_sa_status ON public.salary_advances(status);
CREATE INDEX IF NOT EXISTS idx_sa_date ON public.salary_advances(advance_date);

DROP POLICY IF EXISTS "auth_select_salary_advances" ON public.salary_advances;
CREATE POLICY "auth_select_salary_advances" ON public.salary_advances FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_salary_advances" ON public.salary_advances;
CREATE POLICY "auth_insert_salary_advances" ON public.salary_advances FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_salary_advances" ON public.salary_advances;
CREATE POLICY "auth_update_salary_advances" ON public.salary_advances FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_salary_advances" ON public.salary_advances;
CREATE POLICY "auth_delete_salary_advances" ON public.salary_advances FOR DELETE TO authenticated USING (true);

-- ============================================================
-- 2. salary_advance_recoveries table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.salary_advance_recoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salary_advance_id uuid NOT NULL REFERENCES public.salary_advances(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  recovery_date date NOT NULL DEFAULT CURRENT_DATE,
  salary_month text,
  recovery_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (recovery_amount >= 0),
  remarks text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.salary_advance_recoveries ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_sar_advance ON public.salary_advance_recoveries(salary_advance_id);
CREATE INDEX IF NOT EXISTS idx_sar_employee ON public.salary_advance_recoveries(employee_id);
CREATE INDEX IF NOT EXISTS idx_sar_date ON public.salary_advance_recoveries(recovery_date);

DROP POLICY IF EXISTS "auth_select_salary_advance_recoveries" ON public.salary_advance_recoveries;
CREATE POLICY "auth_select_salary_advance_recoveries" ON public.salary_advance_recoveries FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_salary_advance_recoveries" ON public.salary_advance_recoveries;
CREATE POLICY "auth_insert_salary_advance_recoveries" ON public.salary_advance_recoveries FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_salary_advance_recoveries" ON public.salary_advance_recoveries;
CREATE POLICY "auth_update_salary_advance_recoveries" ON public.salary_advance_recoveries FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_salary_advance_recoveries" ON public.salary_advance_recoveries;
CREATE POLICY "auth_delete_salary_advance_recoveries" ON public.salary_advance_recoveries FOR DELETE TO authenticated USING (true);

-- ============================================================
-- 3. Migrate existing advance_salary values into transactions
-- ============================================================
INSERT INTO public.salary_advances (employee_id, advance_date, advance_reference, advance_amount, reason, payment_mode, remarks, status)
SELECT e.id, e.created_at::date, 'ADV-MIG-' || e.name, e.advance_salary, 'Migrated from Employee Master', 'Cash', 'Initial migration from employee master', 'Outstanding'
FROM public.employees e
WHERE COALESCE(e.advance_salary, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.salary_advances sa WHERE sa.employee_id = e.id AND sa.advance_reference LIKE 'ADV-MIG-%'
  );
