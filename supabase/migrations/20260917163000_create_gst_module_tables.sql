/*
# GST Module — new read-only reporting layer tables

The new GST module (src/pages/Gst) is a read-only reporting/export layer
over the EXISTING `invoices` (invoice_type = 'GST') and `purchases` tables
- it never writes to either. This migration only adds new, clearly-named
GST-only tables plus the page/role seed needed to register the module in
the existing Pages/Roles system. No existing table, column, policy,
function, or row is touched.

New tables:
1. `gst_monthly_reviews`   - Monthly Status (Not Reviewed/Under
   Review/Reviewed) + Reopen Month, keyed by financial_year + month.
2. `gst_manual_adjustments` - GSTR-3B fields the ERP has no source data
   for (Reverse Charge, Exempt/Nil/Non-GST, Interest, Late Fee) - always
   shown in the UI as "Manually Entered", keyed by financial_year + month.
3. `gst_purchase_itc`      - Per-purchase ITC-eligibility override for the
   GST agent. Absence of a row means "eligible" (the default assumption
   whenever the purchase has GST applied) - this table only records
   exceptions, and references `purchases(id)` by FK without altering that
   table.

Page/role seed (mirrors the existing
20260903170506_add_missing_pages_and_auto_sync migration's pattern):
- Registers `/gst` in `pages`.
- Adds a new `GST Agent` role, linked ONLY to the `/gst` page, so a GST
  filer can be given a login without any other access. Admin continues to
  see every page automatically (existing `upsert_page` behavior).
*/

-- ============================================================
-- 1. gst_monthly_reviews
-- ============================================================
CREATE TABLE IF NOT EXISTS public.gst_monthly_reviews (
  financial_year text NOT NULL,
  month smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  status text NOT NULL DEFAULT 'Not Reviewed' CHECK (status IN ('Not Reviewed', 'Under Review', 'Reviewed')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  reopened_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (financial_year, month)
);
ALTER TABLE public.gst_monthly_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_gst_monthly_reviews" ON public.gst_monthly_reviews;
DROP POLICY IF EXISTS "auth_insert_gst_monthly_reviews" ON public.gst_monthly_reviews;
DROP POLICY IF EXISTS "auth_update_gst_monthly_reviews" ON public.gst_monthly_reviews;
DROP POLICY IF EXISTS "auth_delete_gst_monthly_reviews" ON public.gst_monthly_reviews;
CREATE POLICY "auth_select_gst_monthly_reviews" ON public.gst_monthly_reviews FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_gst_monthly_reviews" ON public.gst_monthly_reviews FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_gst_monthly_reviews" ON public.gst_monthly_reviews FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_gst_monthly_reviews" ON public.gst_monthly_reviews FOR DELETE TO authenticated USING (true);

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.gst_monthly_reviews;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.gst_monthly_reviews FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 2. gst_manual_adjustments
-- ============================================================
CREATE TABLE IF NOT EXISTS public.gst_manual_adjustments (
  financial_year text NOT NULL,
  month smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  reverse_charge_amount numeric NOT NULL DEFAULT 0,
  exempt_nil_nongst_amount numeric NOT NULL DEFAULT 0,
  interest_amount numeric NOT NULL DEFAULT 0,
  late_fee_amount numeric NOT NULL DEFAULT 0,
  notes text,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (financial_year, month)
);
ALTER TABLE public.gst_manual_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_gst_manual_adjustments" ON public.gst_manual_adjustments;
DROP POLICY IF EXISTS "auth_insert_gst_manual_adjustments" ON public.gst_manual_adjustments;
DROP POLICY IF EXISTS "auth_update_gst_manual_adjustments" ON public.gst_manual_adjustments;
DROP POLICY IF EXISTS "auth_delete_gst_manual_adjustments" ON public.gst_manual_adjustments;
CREATE POLICY "auth_select_gst_manual_adjustments" ON public.gst_manual_adjustments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_gst_manual_adjustments" ON public.gst_manual_adjustments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_gst_manual_adjustments" ON public.gst_manual_adjustments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_gst_manual_adjustments" ON public.gst_manual_adjustments FOR DELETE TO authenticated USING (true);

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.gst_manual_adjustments;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.gst_manual_adjustments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 3. gst_purchase_itc (per-purchase ITC eligibility override)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.gst_purchase_itc (
  purchase_id uuid PRIMARY KEY REFERENCES public.purchases(id) ON DELETE CASCADE,
  itc_eligible boolean NOT NULL DEFAULT true,
  reason text,
  set_by uuid REFERENCES auth.users(id),
  set_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gst_purchase_itc ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_gst_purchase_itc" ON public.gst_purchase_itc;
DROP POLICY IF EXISTS "auth_insert_gst_purchase_itc" ON public.gst_purchase_itc;
DROP POLICY IF EXISTS "auth_update_gst_purchase_itc" ON public.gst_purchase_itc;
DROP POLICY IF EXISTS "auth_delete_gst_purchase_itc" ON public.gst_purchase_itc;
CREATE POLICY "auth_select_gst_purchase_itc" ON public.gst_purchase_itc FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_gst_purchase_itc" ON public.gst_purchase_itc FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_gst_purchase_itc" ON public.gst_purchase_itc FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_gst_purchase_itc" ON public.gst_purchase_itc FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_gst_purchase_itc_purchase_id ON public.gst_purchase_itc (purchase_id);

-- ============================================================
-- 4. Register the /gst page and seed a GST Agent role
-- ============================================================
INSERT INTO pages (path, label_key, label, section, icon, sort_order) VALUES
  ('/gst', 'gst', 'GST', 'gst', 'Landmark', 39)
ON CONFLICT (path) DO UPDATE SET
  label_key  = EXCLUDED.label_key,
  label      = EXCLUDED.label,
  section    = EXCLUDED.section,
  icon       = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- Admin (all pages) already picks this up via the existing seed pattern below.
INSERT INTO role_pages (role_id, page_id)
SELECT r.id, p.id FROM roles r CROSS JOIN pages p
WHERE r.name = 'Admin' AND p.path = '/gst'
ON CONFLICT (role_id, page_id) DO NOTHING;

INSERT INTO roles (name, description, is_system, is_active)
VALUES ('GST Agent', 'Read-only access to the GST module only, for the GST filing agent', false, true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, updated_at = now();

INSERT INTO role_pages (role_id, page_id)
SELECT r.id, p.id FROM roles r CROSS JOIN pages p
WHERE r.name = 'GST Agent' AND p.path = '/gst'
ON CONFLICT (role_id, page_id) DO NOTHING;
