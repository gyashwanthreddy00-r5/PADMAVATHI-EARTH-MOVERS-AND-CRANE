/*
  # Payment ledgers for Purchase, Diesel, Maintenance

  ## Problem
  These three modules only ever stored payment as a single cumulative
  `paid_amount` field directly on the purchase/diesel_entries/maintenance
  row itself - there was no record of individual installment events. This
  meant the Bank-sync trigger for each (keyed on the parent row's own id)
  could only ever represent "the current total paid so far" as ONE bank
  transaction: a second installment just overwrote the first transaction's
  amount instead of creating a second one. Real multi-installment payments
  (e.g. a purchase bill paid in 3 parts on 3 different dates) collapsed
  into a single combined Bank Credit/Debit, which is not an accurate ledger.

  ## Fix
  Add a proper ledger table per module - `purchase_payments`,
  `diesel_payments`, `maintenance_payments` - one row per actual payment
  event, mirroring the exact pattern `invoice_payments` and
  `salary_payments` already use successfully. A later migration repoints
  the Bank-sync triggers to fire per-ledger-row (one Bank transaction per
  real payment) instead of per-parent-row, and adds a trigger that keeps
  each parent's paid_amount/balance columns correctly summed from its own
  ledger - so every existing read path (list views, reports, totals) that
  already reads `purchases.paid_amount`/`diesel_entries.paid_amount`/
  `maintenance.paid_amount` keeps working unchanged, just now fed by the
  ledger instead of a single field.

  ## Data preservation
  This migration is purely additive - no existing column is dropped, no
  existing row is touched. The old `payment_mode`/`payment_reference`/
  `cheque_number` columns added earlier on these three parent tables
  become unused going forward (payments are now recorded on the ledger
  instead) but are left in place; nothing reads or writes them after this
  change, and no historical data is lost.

  ## Security
  RLS enabled, 4 CRUD policies each, scoped `authenticated`, matching
  every other table in this schema.
*/

CREATE TABLE IF NOT EXISTS public.purchase_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_mode text NOT NULL CHECK (payment_mode IN ('Cash','Bank Transfer','UPI','Cheque','NEFT','RTGS','Online','Other')),
  bank_account_id uuid REFERENCES public.bank_accounts(id),
  reference_number text,
  cheque_number text,
  remarks text,
  is_cancelled boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_payments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_purchase_payments_purchase ON public.purchase_payments (purchase_id, payment_date);

DROP POLICY IF EXISTS "auth_select_purchase_payments" ON public.purchase_payments;
CREATE POLICY "auth_select_purchase_payments" ON public.purchase_payments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_purchase_payments" ON public.purchase_payments;
CREATE POLICY "auth_insert_purchase_payments" ON public.purchase_payments FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_purchase_payments" ON public.purchase_payments;
CREATE POLICY "auth_update_purchase_payments" ON public.purchase_payments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_purchase_payments" ON public.purchase_payments;
CREATE POLICY "auth_delete_purchase_payments" ON public.purchase_payments FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_purchase_payments_updated BEFORE UPDATE ON public.purchase_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.diesel_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diesel_entry_id uuid NOT NULL REFERENCES public.diesel_entries(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_mode text NOT NULL CHECK (payment_mode IN ('Cash','Bank Transfer','UPI','Cheque','NEFT','RTGS','Online','Other')),
  bank_account_id uuid REFERENCES public.bank_accounts(id),
  reference_number text,
  cheque_number text,
  remarks text,
  is_cancelled boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.diesel_payments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_diesel_payments_entry ON public.diesel_payments (diesel_entry_id, payment_date);

DROP POLICY IF EXISTS "auth_select_diesel_payments" ON public.diesel_payments;
CREATE POLICY "auth_select_diesel_payments" ON public.diesel_payments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_diesel_payments" ON public.diesel_payments;
CREATE POLICY "auth_insert_diesel_payments" ON public.diesel_payments FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_diesel_payments" ON public.diesel_payments;
CREATE POLICY "auth_update_diesel_payments" ON public.diesel_payments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_diesel_payments" ON public.diesel_payments;
CREATE POLICY "auth_delete_diesel_payments" ON public.diesel_payments FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_diesel_payments_updated BEFORE UPDATE ON public.diesel_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.maintenance_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_id uuid NOT NULL REFERENCES public.maintenance(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_mode text NOT NULL CHECK (payment_mode IN ('Cash','Bank Transfer','UPI','Cheque','NEFT','RTGS','Online','Other')),
  bank_account_id uuid REFERENCES public.bank_accounts(id),
  reference_number text,
  cheque_number text,
  remarks text,
  is_cancelled boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.maintenance_payments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_maintenance_payments_maintenance ON public.maintenance_payments (maintenance_id, payment_date);

DROP POLICY IF EXISTS "auth_select_maintenance_payments" ON public.maintenance_payments;
CREATE POLICY "auth_select_maintenance_payments" ON public.maintenance_payments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_maintenance_payments" ON public.maintenance_payments;
CREATE POLICY "auth_insert_maintenance_payments" ON public.maintenance_payments FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_maintenance_payments" ON public.maintenance_payments;
CREATE POLICY "auth_update_maintenance_payments" ON public.maintenance_payments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_maintenance_payments" ON public.maintenance_payments;
CREATE POLICY "auth_delete_maintenance_payments" ON public.maintenance_payments FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_maintenance_payments_updated BEFORE UPDATE ON public.maintenance_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
