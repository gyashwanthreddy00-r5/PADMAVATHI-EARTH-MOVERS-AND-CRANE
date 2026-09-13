/*
  # Fix table name collision from 20260913090000

  The previous migration tried to create a table named `po_orders` for the
  new "PO Order Management" feature, not realizing `po_orders` already
  existed (since 20260908120000) as the header table for the completely
  unrelated "Log Book Entries" page (still labelled "PO Orders" at the table
  level, even though its nav label was renamed). Because that CREATE TABLE
  used IF NOT EXISTS, it silently no-op'd - the new po_order_items and
  po_utilization tables it also created ended up with a foreign key pointing
  at the OLD po_orders table's id column instead of a new one.

  This migration:
  1. Drops the stray "authenticated_access" policy the previous migration
     added to the pre-existing po_orders table (redundant alongside its own
     auth_select/insert/update/delete policies - removing it purely to avoid
     leaving unrelated cruft on a table this feature doesn't own).
  2. Drops the two incorrectly-linked tables from the previous migration
     (po_order_items, po_utilization) - both empty, created moments ago,
     never used by any application code yet, so dropping them loses nothing.
  3. Re-creates the whole "PO Order Management" schema under non-colliding
     names: purchase_orders, purchase_order_items, purchase_order_utilization.
*/

DROP POLICY IF EXISTS "authenticated_access" ON public.po_orders;

DROP TABLE IF EXISTS public.po_utilization;
DROP TABLE IF EXISTS public.po_order_items;

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  po_number text NOT NULL,
  po_date date NOT NULL,
  valid_from date,
  valid_to date,
  taxable_total numeric NOT NULL DEFAULT 0,
  cgst_total numeric NOT NULL DEFAULT 0,
  sgst_total numeric NOT NULL DEFAULT 0,
  grand_total numeric NOT NULL DEFAULT 0,
  utilized_amount numeric NOT NULL DEFAULT 0,
  remaining_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Completed', 'Expired')),
  low_balance_threshold numeric NOT NULL DEFAULT 20000,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  sl_no integer NOT NULL,
  vehicle_type text NOT NULL,
  quantity numeric NOT NULL,
  unit_rate numeric NOT NULL,
  taxable_amount numeric NOT NULL,
  cgst_amount numeric NOT NULL,
  sgst_amount numeric NOT NULL,
  total_amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_order_utilization (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  invoice_number text,
  invoice_date date,
  utilized_amount numeric NOT NULL,
  balance_after numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_customer_id ON public.purchase_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON public.purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po_id ON public.purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_utilization_po_id ON public.purchase_order_utilization(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_utilization_invoice_id ON public.purchase_order_utilization(invoice_id);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_access" ON public.purchase_orders;
CREATE POLICY "authenticated_access" ON public.purchase_orders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_access" ON public.purchase_order_items;
CREATE POLICY "authenticated_access" ON public.purchase_order_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.purchase_order_utilization ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_access" ON public.purchase_order_utilization;
CREATE POLICY "authenticated_access" ON public.purchase_order_utilization
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO pages (path, label_key, label, section, icon, sort_order) VALUES
  ('/purchase-orders', 'purchaseOrders', 'PO Orders', 'billing', 'ClipboardList', 35)
ON CONFLICT (path) DO UPDATE SET
  label_key = EXCLUDED.label_key,
  label = EXCLUDED.label,
  section = EXCLUDED.section,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO role_pages (role_id, page_id)
SELECT r.id, p.id FROM roles r CROSS JOIN pages p
WHERE r.name = 'Admin' AND p.path = '/purchase-orders'
ON CONFLICT (role_id, page_id) DO NOTHING;
