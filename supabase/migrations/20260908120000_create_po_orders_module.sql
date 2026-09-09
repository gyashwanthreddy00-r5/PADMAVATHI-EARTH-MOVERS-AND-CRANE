/*
# PO Orders module

Adds a new, self-contained "PO Orders" module: Customer -> PO Order ->
Operation/Working Records -> working-day billing entries -> invoice -> GST.

Design notes:
  - Rates come ONLY from the existing `rate_master` table (vehicle_type +
    capacity_tons, versioned). There is no separate PO-specific rate table —
    PO Orders looks rates up exactly the way Trips does, via vehicle type +
    capacity + effective date.
  - `trips` was considered as the "Operation / Working Data" source but is
    empty in production for this workflow (this billing arrangement is not
    tracked via Trip Entries), so PO Orders gets its own working-data table,
    fed by the user logging working days directly in the module.

1. New tables
   - `po_orders` — the PO header: PO/Order Number, PO Date, status. One
     customer can have many PO Orders. No validity period fields (Valid
     From/To) — deliberately not part of this table.
   - `po_working_records` — the "Operation / Working Data" source. One row
     per (customer, date, vehicle) the user logs: which crane worked, on
     what date, for how long (Hourly = hours+minutes, or Daily). Vehicle is
     picked from the existing Vehicle Master (`vehicles`) so Ton is always
     correct and consistent with it.
   - `po_order_lines` — one row per working-day billed under a specific PO
     Order + invoice. Each line snapshots its source `po_working_records`
     row at the moment it's added, and carries the manually-entered VL No,
     Invoice Number, Bill Date and Place of Work. A working record can only
     be added once (unique working_record_id) so the same day's work can't
     be double-billed, even across different PO Orders.

2. Security
   - Same pattern as every other table in this app: RLS enabled, authenticated
     users get full CRUD (USING true / WITH CHECK true).

3. Page registration
   - Registers `/po-orders` in `pages` (section 'billing') and links it to the
     Admin role, exactly like every other page registration migration here.
*/

-- =============================================================
-- 1. po_orders (PO header)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.po_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  po_number text NOT NULL,
  po_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Closed')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, po_number)
);

CREATE INDEX IF NOT EXISTS idx_po_orders_customer ON public.po_orders (customer_id, created_at DESC);

ALTER TABLE public.po_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_po_orders" ON public.po_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_po_orders" ON public.po_orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_po_orders" ON public.po_orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_po_orders" ON public.po_orders FOR DELETE TO authenticated USING (true);

-- =============================================================
-- 2. po_working_records ("Operation / Working Data")
-- =============================================================
CREATE TABLE IF NOT EXISTS public.po_working_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  working_date date NOT NULL,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  vehicle_number text NOT NULL,
  ton numeric NOT NULL,
  rate_type text NOT NULL DEFAULT 'Hourly' CHECK (rate_type IN ('Hourly', 'Daily')),
  hours integer NOT NULL DEFAULT 0,
  minutes integer NOT NULL DEFAULT 0 CHECK (minutes >= 0 AND minutes < 60),
  batta numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_working_records_customer_date ON public.po_working_records (customer_id, working_date);

ALTER TABLE public.po_working_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_po_working_records" ON public.po_working_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_po_working_records" ON public.po_working_records FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_po_working_records" ON public.po_working_records FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_po_working_records" ON public.po_working_records FOR DELETE TO authenticated USING (true);

-- =============================================================
-- 3. po_order_lines
-- =============================================================
CREATE TABLE IF NOT EXISTS public.po_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_order_id uuid NOT NULL REFERENCES public.po_orders(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  working_record_id uuid UNIQUE REFERENCES public.po_working_records(id) ON DELETE SET NULL,
  working_date date NOT NULL,
  ton numeric NOT NULL,
  vehicle_id uuid REFERENCES public.vehicles(id),
  vehicle_number text NOT NULL,
  rate_type text NOT NULL DEFAULT 'Hourly' CHECK (rate_type IN ('Hourly', 'Daily')),
  hours integer NOT NULL DEFAULT 0,
  minutes integer NOT NULL DEFAULT 0 CHECK (minutes >= 0 AND minutes < 60),
  batta numeric NOT NULL DEFAULT 0,
  vl_no text NOT NULL,
  invoice_number text NOT NULL,
  bill_date date NOT NULL,
  place_of_work text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_order_lines_po_order ON public.po_order_lines (po_order_id, invoice_number, created_at);
CREATE INDEX IF NOT EXISTS idx_po_order_lines_customer ON public.po_order_lines (customer_id);

ALTER TABLE public.po_order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_po_order_lines" ON public.po_order_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_po_order_lines" ON public.po_order_lines FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_po_order_lines" ON public.po_order_lines FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_po_order_lines" ON public.po_order_lines FOR DELETE TO authenticated USING (true);

-- =============================================================
-- 4. updated_at triggers (reuses the existing public.set_updated_at())
-- =============================================================
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.po_orders;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.po_orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.po_order_lines;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.po_order_lines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================
-- 5. Register the page (idempotent, same pattern as every other page seed)
-- =============================================================
INSERT INTO pages (path, label_key, label, section, icon, sort_order) VALUES
  ('/po-orders', 'poOrders', 'PO Orders', 'billing', 'FileSpreadsheet', 36)
ON CONFLICT (path) DO UPDATE SET
  label_key = EXCLUDED.label_key,
  label = EXCLUDED.label,
  section = EXCLUDED.section,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO role_pages (role_id, page_id)
SELECT r.id, p.id FROM roles r CROSS JOIN pages p
WHERE r.name = 'Admin' AND p.path = '/po-orders'
ON CONFLICT (role_id, page_id) DO NOTHING;
