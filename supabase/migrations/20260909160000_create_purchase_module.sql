/*
# Purchase module — vendors + purchases

New "Purchase" screen under Operations: vendors are created inline on the
Purchase page itself (no separate Vendor Master page), and each vendor has
its own serial-wise purchase entries with 18% GST and paid/balance tracking.

New tables (purely additive — no existing table/column is touched):
  `vendors`   — id, name (required), phone, address, gst_number
  `purchases` — id, vendor_id (FK), bill_no, remark, purchase_date, amount,
                gst_rate, gst_amount, total_amount, paid_amount,
                balance_amount. gst_amount/total_amount/balance_amount are
                snapshotted at save time (not recomputed from today's rate),
                same historical-safety pattern as invoice_billing_lines.

Vendor deletion is blocked while purchase history exists (ON DELETE
RESTRICT) rather than silently cascading, since the app has no explicit
cascading-delete UX for this yet.
*/

CREATE TABLE IF NOT EXISTS public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  address text,
  gst_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  bill_no text,
  remark text,
  purchase_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL DEFAULT 0,
  gst_rate numeric NOT NULL DEFAULT 18,
  gst_amount numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  balance_amount numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchases_vendor_date ON public.purchases (vendor_id, purchase_date);

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_vendors" ON public.vendors;
DROP POLICY IF EXISTS "auth_insert_vendors" ON public.vendors;
DROP POLICY IF EXISTS "auth_update_vendors" ON public.vendors;
DROP POLICY IF EXISTS "auth_delete_vendors" ON public.vendors;
CREATE POLICY "auth_select_vendors" ON public.vendors FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_vendors" ON public.vendors FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_vendors" ON public.vendors FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_vendors" ON public.vendors FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_select_purchases" ON public.purchases;
DROP POLICY IF EXISTS "auth_insert_purchases" ON public.purchases;
DROP POLICY IF EXISTS "auth_update_purchases" ON public.purchases;
DROP POLICY IF EXISTS "auth_delete_purchases" ON public.purchases;
CREATE POLICY "auth_select_purchases" ON public.purchases FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_purchases" ON public.purchases FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_purchases" ON public.purchases FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_purchases" ON public.purchases FOR DELETE TO authenticated USING (true);

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.vendors;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.purchases;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.purchases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
