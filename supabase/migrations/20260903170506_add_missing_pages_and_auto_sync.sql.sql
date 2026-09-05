/*
# Add missing pages and auto-sync helper

1. Purpose
- Three pages developed recently were never inserted into the `pages` table:
  `/quotations`, `/settlement-report`, `/reports/cash-payment`.
- This migration inserts them, links them to the Admin role, and creates
  a SECURITY DEFINER function `upsert_page` that the frontend can call
  to auto-register any new page on app load.

2. New rows in `pages`
- `/quotations`            label_key 'quotations'           section 'masters'   icon 'ClipboardList'  sort 33
- `/settlement-report`     label_key 'settlementReport'     section 'billing'   icon 'Wallet'          sort 34
- `/reports/cash-payment`  label_key 'cashPaymentReport'    section 'billing'   icon 'IndianRupee'     sort 35

3. role_pages
- All three new pages are linked to the Admin role.

4. New function
- `upsert_page(p_path, p_label_key, p_label, p_section, p_icon, p_sort_order)`
  Inserts the page if missing, updates label/section/icon/sort if present.
  Returns the page row. SECURITY DEFINER so the anon/authenticated client
  can call it via RPC without needing direct INSERT privileges.

5. Security
- Function is SECURITY DEFINER, owned by postgres, with a fixed search_path.
- Existing RLS policies on `pages` remain unchanged.
*/

-- Insert missing pages (idempotent)
INSERT INTO pages (path, label_key, label, section, icon, sort_order) VALUES
  ('/quotations',            'quotations',          'Quotations',          'masters', 'ClipboardList', 33),
  ('/settlement-report',     'settlementReport',    'Settlement Report',   'billing',  'Wallet',        34),
  ('/reports/cash-payment',  'cashPaymentReport',   'Cash Payment Report',  'billing',  'IndianRupee',   35)
ON CONFLICT (path) DO UPDATE SET
  label_key  = EXCLUDED.label_key,
  label      = EXCLUDED.label,
  section    = EXCLUDED.section,
  icon       = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- Link new pages to Admin role
INSERT INTO role_pages (role_id, page_id)
SELECT r.id, p.id FROM roles r CROSS JOIN pages p
WHERE r.name = 'Admin'
  AND p.path IN ('/quotations', '/settlement-report', '/reports/cash-payment')
ON CONFLICT (role_id, page_id) DO NOTHING;

-- =============================================================
-- Auto-sync function: frontend calls this on app load to register
-- any new page that was added to the codebase but not yet in the DB.
-- =============================================================
CREATE OR REPLACE FUNCTION public.upsert_page(
  p_path text,
  p_label_key text DEFAULT NULL,
  p_label text DEFAULT NULL,
  p_section text DEFAULT NULL,
  p_icon text DEFAULT NULL,
  p_sort_order integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO pages (path, label_key, label, section, icon, sort_order)
  VALUES (p_path, p_label_key, p_label, p_section, p_icon, p_sort_order)
  ON CONFLICT (path) DO UPDATE SET
    label_key  = COALESCE(EXCLUDED.label_key, pages.label_key),
    label      = COALESCE(EXCLUDED.label, pages.label),
    section    = COALESCE(EXCLUDED.section, pages.section),
    icon       = COALESCE(EXCLUDED.icon, pages.icon),
    sort_order = COALESCE(EXCLUDED.sort_order, pages.sort_order),
    updated_at = now()
  RETURNING id INTO v_id;

  -- Ensure Admin role always has access to every page
  INSERT INTO role_pages (role_id, page_id)
  SELECT r.id, v_id FROM roles r WHERE r.name = 'Admin'
  ON CONFLICT (role_id, page_id) DO NOTHING;

  RETURN v_id;
END;
$$;

-- Grant execute to authenticated users (they call this on app load)
GRANT EXECUTE ON FUNCTION public.upsert_page TO authenticated;
