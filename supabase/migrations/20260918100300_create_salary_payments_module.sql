/*
  # Salary Payments module

  There is no "regular monthly Salary Payment" concept anywhere in the
  schema today — `salary_advances`/`salary_advance_recoveries` (see
  20260820074729) track advances only, and `employees.salary` is just a
  static monthly rate. This adds a proper ledger table (one row per salary
  payment event) so the new Bank module can sync it.

  1. New Table: `salary_payments`
  - employee_id (FK -> employees, SET NULL)
  - salary_month (text, e.g. "September 2026" — derived from payment_date)
  - amount, payment_date, payment_mode, reference_number, cheque_number
  - bank_account_id (FK -> bank_accounts, required when payment_mode is not
    Cash — which bank account the salary was actually paid from)
  - remarks, is_cancelled (soft-reversal, mirrors every other module here)
  - created_by/at, updated_at

  2. Security
  - RLS enabled, 4 CRUD policies, scoped `authenticated`.
*/

CREATE TABLE IF NOT EXISTS public.salary_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  salary_month text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_mode text NOT NULL CHECK (payment_mode IN ('Cash','Bank Transfer','UPI','Cheque','NEFT','RTGS','Online','Other')),
  reference_number text,
  cheque_number text,
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  remarks text,
  is_cancelled boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.salary_payments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_salary_payments_employee ON public.salary_payments (employee_id, payment_date DESC);

DROP POLICY IF EXISTS "auth_select_salary_payments" ON public.salary_payments;
CREATE POLICY "auth_select_salary_payments" ON public.salary_payments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_salary_payments" ON public.salary_payments;
CREATE POLICY "auth_insert_salary_payments" ON public.salary_payments FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_salary_payments" ON public.salary_payments;
CREATE POLICY "auth_update_salary_payments" ON public.salary_payments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_salary_payments" ON public.salary_payments;
CREATE POLICY "auth_delete_salary_payments" ON public.salary_payments FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_salary_payments_updated BEFORE UPDATE ON public.salary_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
