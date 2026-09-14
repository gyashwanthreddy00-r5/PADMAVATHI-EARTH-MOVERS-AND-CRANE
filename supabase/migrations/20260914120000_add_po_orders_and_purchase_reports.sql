/*
  # Register PO Orders Report and Purchase Report pages

  Two new report pages were added under REPORTS: /reports/po-orders (PO Orders
  Report) and /reports/purchase (Purchase Report). The app also auto-syncs these
  same rows into `pages` on the next Admin login (see AuthContext.tsx's
  `appRoutes`/`upsert_page` call) - this migration exists so the pages are
  visible immediately, and so non-Admin roles (which only see pages granted via
  role_pages, not the Admin auto-sync) can be granted access too, matching the
  exact pattern used by the most recent page addition
  (20260913091500_fix_po_order_management_table_name_collision.sql).
*/

INSERT INTO pages (path, label_key, label, section, icon, sort_order) VALUES
  ('/reports/po-orders', 'poOrdersReport', 'PO Orders Report', 'reports', 'ClipboardList', 37),
  ('/reports/purchase', 'purchaseReportNav', 'Purchase Report', 'reports', 'ShoppingCart', 38)
ON CONFLICT (path) DO UPDATE SET
  label_key = EXCLUDED.label_key,
  label = EXCLUDED.label,
  section = EXCLUDED.section,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO role_pages (role_id, page_id)
SELECT r.id, p.id FROM roles r CROSS JOIN pages p
WHERE r.name = 'Admin' AND p.path IN ('/reports/po-orders', '/reports/purchase')
ON CONFLICT (role_id, page_id) DO NOTHING;
