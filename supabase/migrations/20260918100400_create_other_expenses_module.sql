/*
  # Other Expenses module

  No table or page for miscellaneous business expenses (Repairs, Rent,
  Electricity, Bank Charges, Internet, Transport Expenses, Other) exists
  today. This adds a ledger table (one row per expense payment) so the new
  Bank module can sync it, without touching Diesel/Maintenance which already
  cover vehicle-specific repair/fuel costs.

  1. New Table: `other_expenses`
  - expense_date, category (fixed set), particulars, amount
  - payment_mode, reference_number, cheque_number, remarks
  - is_cancelled (soft-reversal, mirrors every other module here)
  - created_by/at, updated_at

  2. Security
  - RLS enabled, 4 CRUD policies, scoped `authenticated`.
*/

CREATE TABLE IF NOT EXISTS public.other_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  category text NOT NULL CHECK (category IN ('Repairs','Rent','Electricity','Bank Charges','Internet','Transport Expenses','Other')),
  particulars text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  payment_mode text NOT NULL CHECK (payment_mode IN ('Cash','Bank Transfer','UPI','Cheque','NEFT','RTGS','Online','Other')),
  reference_number text,
  cheque_number text,
  remarks text,
  is_cancelled boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.other_expenses ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_other_expenses_date ON public.other_expenses (expense_date DESC);

DROP POLICY IF EXISTS "auth_select_other_expenses" ON public.other_expenses;
CREATE POLICY "auth_select_other_expenses" ON public.other_expenses FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_other_expenses" ON public.other_expenses;
CREATE POLICY "auth_insert_other_expenses" ON public.other_expenses FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_other_expenses" ON public.other_expenses;
CREATE POLICY "auth_update_other_expenses" ON public.other_expenses FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_other_expenses" ON public.other_expenses;
CREATE POLICY "auth_delete_other_expenses" ON public.other_expenses FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_other_expenses_updated BEFORE UPDATE ON public.other_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
