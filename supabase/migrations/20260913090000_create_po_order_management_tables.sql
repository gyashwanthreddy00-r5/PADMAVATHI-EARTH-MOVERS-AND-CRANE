/*
  # PO Order Management module

  Brand-new, fully isolated tables for the new "PO Orders" feature (customer
  Purchase Orders used as a spending ceiling against GST invoices) - a
  completely different concept from the existing po_working_records /
  po_order_lines tables that back the "Log Book Entries" page (formerly
  labelled "PO Orders" in the nav, now renamed - see prior migrations).

  No existing table (invoices, invoice_items, po_working_records,
  po_order_lines, etc.) is altered, renamed, or dropped by this migration.
  The invoice -> PO link lives entirely in po_utilization (invoice_id +
  a snapshotted invoice_number/invoice_date), so invoices never needs a new
  column for this feature.

  - po_orders: one row per customer Purchase Order. utilized_amount /
    remaining_amount are maintained by the application (mirroring how
    invoices.balance_amount is already maintained elsewhere in this app),
    not by a DB trigger.
  - po_order_items: the crane/ton line items entered when the PO is created,
    each snapshotting its own taxable/CGST/SGST/total at PO-creation time.
  - po_utilization: one row per GST invoice that drew against a PO, so PO
    Details can show a full "Invoice Number / Invoice Date / Invoice Amount /
    Balance After Invoice" utilization history.
*/

CREATE TABLE IF NOT EXISTS public.po_orders (
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

CREATE TABLE IF NOT EXISTS public.po_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.po_orders(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS public.po_utilization (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.po_orders(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  invoice_number text,
  invoice_date date,
  utilized_amount numeric NOT NULL,
  balance_after numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_orders_customer_id ON public.po_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_po_orders_status ON public.po_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_order_items_po_id ON public.po_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_po_utilization_po_id ON public.po_utilization(po_id);
CREATE INDEX IF NOT EXISTS idx_po_utilization_invoice_id ON public.po_utilization(invoice_id);

ALTER TABLE public.po_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_access" ON public.po_orders;
CREATE POLICY "authenticated_access" ON public.po_orders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.po_order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_access" ON public.po_order_items;
CREATE POLICY "authenticated_access" ON public.po_order_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.po_utilization ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_access" ON public.po_utilization;
CREATE POLICY "authenticated_access" ON public.po_utilization
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
